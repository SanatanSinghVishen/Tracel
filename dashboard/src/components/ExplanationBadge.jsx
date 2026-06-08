import React from 'react';

const ExplanationBadge = ({ explanation }) => {
  if (!explanation || explanation.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1 text-xs">
      <span className="text-red-400 font-semibold mr-1">Flagged for:</span>
      {explanation.map((item, idx) => {
        const isPositive = item.shap_value > 0;
        const colorClass = isPositive ? 'text-red-400' : 'text-green-400';
        const sign = isPositive ? '+' : '';
        return (
          <span
            key={item.feature}
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-white/10"
            title={`Actual value: ${item.actual_value}`}
          >
            <span className="text-gray-300 font-mono mr-1">{item.feature}</span>
            <span className={`${colorClass} font-mono`}>{sign}{item.shap_value.toFixed(2)}</span>
            {idx < explanation.length - 1 && <span className="ml-1 text-gray-500">·</span>}
          </span>
        );
      })}
    </div>
  );
};

export default ExplanationBadge;
