"use client";

import { PositionCard } from "./position-card";
import type { OrgLayerWithPositions } from "./types";

interface OrgStructureHierarchyProps {
  layers: OrgLayerWithPositions[];
}

export function OrgStructureHierarchy({ layers }: OrgStructureHierarchyProps) {
  // Filter out the synthetic Unassigned bucket for hierarchy view
  const realLayers = layers.filter((l) => l.id !== "__unassigned__");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8">
      <div className="flex flex-col items-center">
        {realLayers.map((layer, layerIndex) => (
          <div key={layer.id} className="w-full flex flex-col items-center">
            {/* Layer label */}
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              {layer.name}
            </p>

            {layer.description && (
              <p className="text-xs text-gray-400 mb-4">({layer.description})</p>
            )}

            {/* Position cards row */}
            <div className="flex flex-wrap justify-center gap-4 mb-2">
              {layer.positions.map((position) => (
                <div key={position.id} className="flex flex-col items-center">
                  <PositionCard position={position} compact />
                </div>
              ))}

              {layer.positions.length === 0 && (
                <p className="text-xs text-gray-400 italic">No positions</p>
              )}
            </div>

            {/* Connecting line to next layer */}
            {layerIndex < realLayers.length - 1 && (
              <div className="w-px h-8 bg-gray-300 my-4" />
            )}
          </div>
        ))}

        {realLayers.length > 0 && (
          <div className="mt-8 px-6 py-3 bg-gray-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-gray-700">{realLayers.length}</p>
            <p className="text-xs text-gray-500">layers of hierarchy</p>
          </div>
        )}

        {realLayers.length === 0 && (
          <p className="text-sm text-gray-400">No layers to display.</p>
        )}
      </div>
    </div>
  );
}
