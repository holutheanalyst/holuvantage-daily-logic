// Decides how ranked scores move when a guest's history is merged into an existing account.
// One ranked score per puzzle per player: keep the higher score.
export function mergePlan(guestScores, accountScores) {
  const byPuzzle = new Map(accountScores.map((s) => [s.puzzle_id, s]));
  const moveScoreIds = [], dropGuestScoreIds = [], dropAccountScoreIds = [];
  for (const g of guestScores) {
    const a = byPuzzle.get(g.puzzle_id);
    if (!a) moveScoreIds.push(g.id);
    else if (g.score > a.score) { moveScoreIds.push(g.id); dropAccountScoreIds.push(a.id); }
    else dropGuestScoreIds.push(g.id);
  }
  return { moveScoreIds, dropGuestScoreIds, dropAccountScoreIds };
}
