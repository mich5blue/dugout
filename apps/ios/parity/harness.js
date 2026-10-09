/*
  Engine parity harness: the same inputs through the shipped bundle, on any
  JavaScript engine. Run by scripts/check_parity.mjs on V8 (node) and on
  JavaScriptCore (macOS's jsc), which must print byte-identical output.

  Plain ES5-ish on purpose: it has to run unchanged in both shells.
*/
var out = typeof print !== 'undefined' ? print : console.log;

/* createId falls back to Math.random where there is no crypto.randomUUID,
   which is the case in a bare jsc shell. Seed it identically in both, so
   generated ids match too and the comparison can be total. */
(function () {
  var s = 20260508;
  Math.random = function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
})();

var C = globalThis.InningGridCore;
var NAMES = ['Brody', 'Race', 'Weston', 'Calvin', 'Emerson', 'Solomon',
             'Finnegan', 'Vasil', 'Mehki', 'Ashur', 'Walter'];

var team = {
  id: 't1', name: 'Parity', sport: 'BASEBALL', seasonName: 'S', division: '',
  defaultInnings: 6, defaultFormationId: C.defaultFormationId('BASEBALL'),
  settings: C.defaultTeamSettings(), createdAt: '2026-01-01T00:00:00.000Z'
};

var players = NAMES.map(function (name, i) {
  var p = C.createPlayer({
    teamId: 't1', firstName: name, jerseyNumber: String(i + 2),
    canPitch: i % 3 === 0 || i === 1, canCatch: i % 4 === 1,
    overallTier: i % 5 === 0 ? 'CORE' : i % 4 === 3 ? 'DEVELOPING' : 'REGULAR',
    createdAt: '2026-01-01T00:00:' + (10 + i) + '.000Z'
  });
  p.id = 'p' + i;
  return p;
});

var formation = C.systemFormation(team.defaultFormationId);

function makeGame(id, date) {
  var g = C.createGame({ teamId: 't1', opponent: 'X', date: date, plannedInnings: 6,
                         formation: formation, settings: team.settings,
                         players: players, seed: 7 });
  g.id = id;
  g.createdAt = '2026-01-01T00:00:00.000Z';
  return g;
}

/* What must match: every cell, every batting slot, the score and the words. */
function digest(res) {
  return {
    ok: res.result.ok,
    defensive: res.result.defensive.map(function (a) {
      return a.inning + ':' + a.positionId + '=' + a.playerId + (a.locked ? '!' : '');
    }),
    batting: res.result.batting.map(function (b) { return b.battingSlot + '=' + b.playerId; }),
    score: res.result.quality.score,
    checks: res.result.quality.checks.map(function (c) { return (c.ok ? '+' : '-') + c.label; }),
    explanations: res.result.explanations.map(function (e) { return e.text; })
  };
}

var first = makeGame('g1', '2026-05-01');
/* Walter misses game two, and game one is called after five — so the second
   lineup has real season debt to act on, not a clean slate. */
var second = makeGame('g2', '2026-05-08');
second.gamePlayers = second.gamePlayers.map(function (gp) {
  return gp.playerId === 'p10' ? Object.assign({}, gp, { available: false }) : gp;
});

try {
  var r1 = C.generate({ team: team, game: first, players: players, history: [first], seed: 7 });
  var played = C.recordActualResults(r1.game, 5);
  var r2 = C.generate({ team: team, game: second, players: players,
                        history: [played, second], seed: 11 });
  var season = C.seasonSummary([played], players);
  out(JSON.stringify({
    core: C.version,
    game1: digest(r1),
    game2: digest(r2),
    debts: Object.keys(season.debts).sort().map(function (k) {
      return k + '=' + season.debts[k].defensiveDebt.toFixed(6);
    }),
    view: C.lineupView(r2.game, players).byPlayer
  }));
} catch (e) {
  out('ERROR ' + (e && e.stack || e));
}
