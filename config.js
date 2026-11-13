// Broadgate Pub Golf — shared Firebase connection, roster, and scoring rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAN1HwtDSq26-UPPFXMBImaXUdPnDIUPj0",
  authDomain: "broadgate-pub-golf.firebaseapp.com",
  databaseURL: "https://broadgate-pub-golf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "broadgate-pub-golf",
  storageBucket: "broadgate-pub-golf.firebasestorage.app",
  messagingSenderId: "623279040911",
  appId: "1:623279040911:web:6c5fe0e31da766c7afc3fa"
};

export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const TOTAL_HOLES = 9;
export const SCHEMA_VERSION = 2;
export const TEAMS = [
  { id: "blue", name: "Team Blue", short: "BLU", colour: "#2563eb", members: ["Lizzie", "Kayode", "Alex", "Henry"] },
  { id: "black", name: "Team Black", short: "BLK", colour: "#161b27", members: ["Nelly", "Holly", "Harry", "Isaac", "Rohan"] },
  { id: "red", name: "Team Red", short: "RED", colour: "#d62234", members: ["Emelio", "George", "William", "Maggie", "Sophie"] }
];
export const HOLES = [
  { number: 1, pub: "Broadgate — Flat 12 Kitchen", drink: "Can of choice" },
  { number: 2, pub: "Co-op", drink: "BuzzBall" },
  { number: 3, pub: "Rose and Crown", drink: "Dark Fruits Cider" },
  { number: 4, pub: "Sheaves", drink: "Beer" },
  { number: 5, pub: "Ragland", drink: "Guinness" },
  { number: 6, pub: "Bierkeller", drink: "White Wine" },
  { number: 7, pub: "Roebuck (Spoons)", drink: "Team-shared Pitcher" },
  { number: 8, pub: "Lloyds No. 1 Bar", drink: "Double Raspberry Vodka with Cranberry Juice" },
  { number: 9, pub: "Canal House", drink: "Teams Choice" }
];
export const DEFAULT_SETTINGS = {
  currentHole: 1,
  completedHoles: 0,
  totalHoles: TOTAL_HOLES,
  schemaVersion: SCHEMA_VERSION
};

export function playerKey(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}
export function formatScore(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "–";
}
export function holeBreakdown(record = {}, team, holeNumber) {
  const scores = record.playerScores?.[holeNumber] || {};
  const individualPenalties = record.playerPenalties?.[holeNumber] || {};
  const wholeTeamPenalty = Number(record.teamPenalties?.[holeNumber] || 0);
  const players = team.members || [];
  const keys = players.map(playerKey);
  const complete = keys.length > 0 && keys.every((key) => {
    const value = Number(scores[key]);
    return hasOwn(scores, key) && Number.isInteger(value) && value >= 0;
  });
  const entered = keys.filter((key) => hasOwn(scores, key) && Number.isInteger(Number(scores[key]))).length;
  if (!complete) return { complete: false, entered, count: keys.length, average: null, rawAverage: null, adjustment: null };
  const strokes = keys.reduce((sum, key) => sum + Number(scores[key]), 0);
  const individualTotal = keys.reduce((sum, key) => sum + Number(individualPenalties[key] || 0), 0);
  const rawAverage = strokes / keys.length;
  const adjustment = individualTotal / keys.length + wholeTeamPenalty;
  return { complete: true, entered, count: keys.length, average: rawAverage + adjustment, rawAverage, adjustment };
}

// Rankings count only officially completed holes, preventing a partial current
// hole from unfairly changing the leaderboard. The public scorecard can still
// show a provisional hole average once all its players have entered a score.
export function readTeamScore(record = {}, team, completedHoles = 0) {
  const holeScores = {};
  const progress = {};
  let total = 0;
  let completedWithScores = 0;
  for (let hole = 1; hole <= TOTAL_HOLES; hole++) {
    const result = holeBreakdown(record, team, hole);
    progress[hole] = result;
    if (!result.complete) continue;
    holeScores[hole] = result.average;
    if (hole <= completedHoles) {
      total += result.average;
      completedWithScores++;
    }
  }
  return {
    holeScores,
    progress,
    total,
    holesPlayed: completedHoles,
    hasActivity: completedHoles > 0 && completedWithScores > 0,
    completeCount: completedWithScores,
    playerCount: team.members.length
  };
}
