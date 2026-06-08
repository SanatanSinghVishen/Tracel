import React from 'react';

const TACTIC_COLORS = {
  'Initial Access': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Execution': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Persistence': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Privilege Escalation': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Defense Evasion': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Credential Access': 'text-red-300 border-red-500/20 bg-red-500/10',
  'Discovery': 'text-yellow-300 border-yellow-500/20 bg-yellow-500/10',
  'Lateral Movement': 'text-purple-300 border-purple-500/20 bg-purple-500/10',
  'Collection': 'text-orange-300 border-orange-500/20 bg-orange-500/10',
  'Exfiltration': 'text-orange-300 border-orange-500/20 bg-orange-500/10',
  'Command and Control': 'text-blue-300 border-blue-500/20 bg-blue-500/10',
  'Impact': 'text-red-300 border-red-500/20 bg-red-500/10',
};

const MitreBadge = ({ mitre }) => {
  if (!mitre) return null;

  const colorClass = TACTIC_COLORS[mitre.tactic] || 'text-slate-300 border-white/10 bg-white/5';

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold border ${colorClass} cursor-help`}
      title={`${mitre.technique_name} (${mitre.confidence} confidence)`}
    >
      <span className="mr-1 opacity-70">MITRE {mitre.tactic}:</span> {mitre.technique_id}
    </span>
  );
};

export default MitreBadge;
