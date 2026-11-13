// Badge de distance : couleur ET chiffre (jamais la couleur seule).
export function DistanceBadge({ distance }: { distance: number }) {
  return (
    <span className={`gb-dist gb-dist-${distance}`}>
      {distance}
      <small> km</small>
    </span>
  );
}
