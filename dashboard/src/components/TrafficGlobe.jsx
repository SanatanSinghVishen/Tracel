import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import { Color } from 'three';
import { useSocket } from '../hooks/useSocket.js';
import {
  ATTACK_HOTSPOTS,
  CONTINENT_LABELS,
  MAJOR_COUNTRY_LABELS,
  SERVER_LOCATION,
  getCoordsFromIP,
} from '../utils/geoData.js';

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const lastRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries?.[0]?.contentRect;
      if (!cr) return;
      const next = { width: Math.floor(cr.width), height: Math.floor(cr.height) };
      const prev = lastRef.current;
      // Prevent resize loops/jitter by only updating when size meaningfully changes.
      if (next.width === prev.width && next.height === prev.height) return;
      lastRef.current = next;
      setSize(next);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

export default function TrafficGlobe() {
  const { socket } = useSocket();
  const globeRef = useRef(null);

  const containerRef = useRef(null);
  const { width, height } = useElementSize(containerRef);

  const [arcsData, setArcsData] = useState([]);
  const [threatPoints, setThreatPoints] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [attackActive, setAttackActive] = useState(false);

  const timeoutsRef = useRef(new Map());
  const attackIndexRef = useRef(0);
  const attackIdleTimeoutRef = useRef(null);
  const requestedLocationRef = useRef(false);

  // Camera focus across recent attack points.
  const attackFocusPointsRef = useRef([]);
  const attackFocusIdxRef = useRef(0);
  const attackFocusTimerRef = useRef(null);

  const cyberColors = useMemo(
    () => ({
      safe: '#3b82f6',
      threat: '#f87171',
      bg: '#020617',
    }),
    []
  );

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    try {
      g.pointOfView({ lat: SERVER_LOCATION.lat, lng: SERVER_LOCATION.lng, altitude: 2.1 }, 800);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    try {
      const mat = g.globeMaterial?.();
      if (mat) {
        mat.emissive = new Color('#062a33');
        mat.emissiveIntensity = 0.55;
        mat.shininess = 0.7;
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    try {
      const controls = g.controls?.();
      if (!controls) return;
      controls.autoRotate = attackActive;
      controls.autoRotateSpeed = attackActive ? 1.15 : 0.3;
    } catch {
      // ignore
    }
  }, [attackActive]);

  const requestUserLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setTimeout(() => setLocationError('Geolocation not supported in this browser.'), 0);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationError('');
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setLocationError(err?.message || 'Location permission denied.');
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60_000,
      }
    );
  }, []);

  useEffect(() => {
    // Prompt once as soon as the user switches to Globe view (component mounts).
    // If permission is denied, we keep a retry button.
    if (requestedLocationRef.current) return;
    requestedLocationRef.current = true;
    requestUserLocation();
  }, [requestUserLocation]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;

    function stopAttackFocusLoop() {
      if (attackFocusTimerRef.current) {
        clearTimeout(attackFocusTimerRef.current);
        attackFocusTimerRef.current = null;
      }
    }

    function startAttackFocusLoop() {
      const g = globeRef.current;
      if (!g) return;

      // Avoid stacking loops.
      if (attackFocusTimerRef.current) return;

      const tick = () => {
        const points = attackFocusPointsRef.current;
        if (!Array.isArray(points) || points.length === 0) {
          stopAttackFocusLoop();
          return;
        }

        const idx = attackFocusIdxRef.current % points.length;
        attackFocusIdxRef.current = idx + 1;

        const p = points[idx];
        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          try {
            g.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.7 }, 750);
          } catch {
            // ignore
          }
        }

        attackFocusTimerRef.current = setTimeout(tick, 900);
      };

      attackFocusTimerRef.current = setTimeout(tick, 0);
    }

    function returnToServerView() {
      // Stop focusing and return POV back to the defended server location.
      attackFocusPointsRef.current = [];
      attackFocusIdxRef.current = 0;
      stopAttackFocusLoop();
      setAttackActive(false);

      const g = globeRef.current;
      if (g) {
        try {
          g.pointOfView({ lat: SERVER_LOCATION.lat, lng: SERVER_LOCATION.lng, altitude: 2.1 }, 900);
        } catch {
          // ignore
        }
      }
    }

    function onPacket(packet) {
      if (!packet) return;

      // In Globe mode we only visualize threats/attacks to avoid constant blue arcs.
      const isAttack = Boolean(packet.is_anomaly);
      if (!isAttack) return;

      // Plot the origin deterministically from the packet IP so the globe
      // shows multiple countries instead of cycling a single hotspot.
      const start = packet.source_ip ? getCoordsFromIP(packet.source_ip) : ATTACK_HOTSPOTS[attackIndexRef.current++ % ATTACK_HOTSPOTS.length];
      const end = SERVER_LOCATION;

      const color = cyberColors.threat;
      const id =
        packet._id ||
        `${packet.source_ip || 'unknown'}-${packet.timestamp || Date.now()}-${Math.random().toString(16).slice(2)}`;

      setAttackActive(true);
      if (attackIdleTimeoutRef.current) clearTimeout(attackIdleTimeoutRef.current);
      attackIdleTimeoutRef.current = setTimeout(() => {
        returnToServerView();
      }, 3500);

      // Keep a short list of attack origins and cycle focus across all of them.
      const key = `${start.lat},${start.lng}`;
      const prev = attackFocusPointsRef.current;
      const next = [{ lat: start.lat, lng: start.lng, key }, ...prev.filter((p) => p?.key !== key)].slice(0, 8);
      attackFocusPointsRef.current = next;
      startAttackFocusLoop();

      const arc = {
        id,
        startLat: start.lat,
        startLng: start.lng,
        endLat: end.lat,
        endLng: end.lng,
        color,
        name: start.name || undefined,
      };

      setArcsData((prev) => [...prev, arc]);

      const pointId = `threat-${id}`;
      setThreatPoints((prev) => [
        { id: pointId, lat: start.lat, lng: start.lng, name: start.name || 'Origin', color: cyberColors.threat },
        ...prev,
      ].slice(0, 60));
      const ptTimeout = setTimeout(() => {
        setThreatPoints((prev) => prev.filter((p) => p.id !== pointId));
        timeouts.delete(pointId);
      }, 3500);
      timeouts.set(pointId, ptTimeout);

      const t = setTimeout(() => {
        setArcsData((prev) => prev.filter((a) => a.id !== id));
        timeouts.delete(id);
      }, 2000);

      timeouts.set(id, t);
    }

    socket.on('packet', onPacket);
    return () => {
      socket.off('packet', onPacket);
      for (const t of timeouts.values()) clearTimeout(t);
      timeouts.clear();
      if (attackIdleTimeoutRef.current) clearTimeout(attackIdleTimeoutRef.current);
      stopAttackFocusLoop();
    };
  }, [socket, cyberColors.safe, cyberColors.threat]);

  const pointsData = useMemo(() => {
    const pts = [];
    if (userLocation) {
      pts.push({ id: 'user', lat: userLocation.lat, lng: userLocation.lng, kind: 'user', color: cyberColors.safe });
    }
    for (const p of threatPoints) {
      pts.push({ ...p, kind: 'threat' });
    }
    return pts;
  }, [userLocation, threatPoints, cyberColors.safe]);

  const labelsData = useMemo(() => {
    const uniq = new Map();

    // Persistent labels: continents + a few major countries.
    for (const c of CONTINENT_LABELS) {
      uniq.set(c.name, {
        id: `lbl-cont-${c.name}`,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        kind: 'continent',
        color: 'rgba(226,232,240,0.70)',
      });
    }

    for (const c of MAJOR_COUNTRY_LABELS) {
      uniq.set(c.name, {
        id: `lbl-cty-${c.name}`,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        kind: 'country',
        color: 'rgba(226,232,240,0.78)',
      });
    }

    for (const p of threatPoints) {
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '';
      if (!name) continue;
      if (!uniq.has(name)) {
        uniq.set(name, {
          id: `lbl-${name}`,
          name,
          lat: p.lat,
          lng: p.lng,
          kind: 'threat',
          color: cyberColors.threat,
        });
      }
      if (uniq.size >= 8) break;
    }
    // Always label the defended/server location for context.
    uniq.set('Server', {
      id: 'lbl-server',
      name: SERVER_LOCATION.name || 'Server',
      lat: SERVER_LOCATION.lat,
      lng: SERVER_LOCATION.lng,
      kind: 'server',
      color: cyberColors.safe,
    });
    return Array.from(uniq.values());
  }, [threatPoints, cyberColors.safe, cyberColors.threat]);

  const ringsData = useMemo(() => {
    const rings = [];
    if (userLocation) {
      rings.push({ id: 'user-ring', lat: userLocation.lat, lng: userLocation.lng, kind: 'user', color: cyberColors.safe });
    }
    for (const p of threatPoints) {
      rings.push({ id: `${p.id}-ring`, lat: p.lat, lng: p.lng, kind: 'threat', color: cyberColors.threat });
    }
    return rings;
  }, [userLocation, threatPoints, cyberColors.safe, cyberColors.threat]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[320px]">
      {!userLocation && (
        <div className="absolute left-3 top-3 z-10 max-w-[90%]">
          <div className="glass rounded-2xl border border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestUserLocation}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-xl glass border border-white/10 text-slate-100 hover:bg-white/10"
              >
                Enable Location
              </button>
              <span className="text-[11px] text-slate-200">Pin your current location on the globe</span>
            </div>
            {locationError ? <div className="mt-1 text-[11px] text-red-300">{locationError}</div> : null}
          </div>
        </div>
      )}

      <Globe
        ref={globeRef}
        width={width || undefined}
        height={height || undefined}
        backgroundColor={cyberColors.bg}
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor={cyberColors.safe}
        atmosphereAltitude={0.18}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d) => d.color}
        pointAltitude={(d) => (d.kind === 'user' ? 0.03 : 0.06)}
        pointRadius={(d) => (d.kind === 'user' ? 0.35 : 0.42)}
        ringsData={ringsData}
        ringLat="lat"
        ringLng="lng"
        ringColor={(d) => d.color}
        ringMaxRadius={(d) => (d.kind === 'user' ? 1.8 : 3.2)}
        ringPropagationSpeed={(d) => (d.kind === 'user' ? 1.6 : 2.6)}
        ringRepeatPeriod={(d) => (d.kind === 'user' ? 900 : 650)}
        arcsData={arcsData}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke={0.85}
        arcAltitude={0.22}
        arcDashLength={0.45}
        arcDashGap={2.2}
        arcDashAnimateTime={2000}
        arcsTransitionDuration={0}

        labelsData={labelsData}
        labelLat="lat"
        labelLng="lng"
        labelText={(d) => d.name}
        labelSize={(d) => (d.kind === 'continent' ? 1.55 : d.kind === 'country' ? 1.15 : 1.1)}
        labelDotRadius={(d) => (d.kind === 'threat' || d.kind === 'server' ? 0.22 : 0)}
        labelAltitude={(d) => (d.kind === 'continent' ? 0.095 : d.kind === 'country' ? 0.085 : 0.07)}
        labelColor={(d) => d.color}
      />
    </div>
  );
}
