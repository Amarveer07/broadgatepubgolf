// BROADGATE PUB GOLF — shared event settings and Firebase connection.
// We will reuse this file on the Teams, Scorecard, Route and Ref pages.
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

export const eventName = "Broadgate Pub Golf";
export const TOTAL_HOLES = 9;

// Team names, colours and members are already finalised.
// Player photos will be added later without changing the layout.
export const TEAMS = [
  { id: "red", name: "Team Red", short: "RED", colour: "#d91f30", members: ["Nelly", "Holly", "Harry", "Isaac"] },
  { id: "green", name: "Team Green", short: "GRN", colour: "#128447", members: ["Emelio", "George", "Henry", "Rohan"] },
  { id: "blue", name: "Team Blue", short: "BLU", colour: "#2365eb", members: ["Lizzie", "Jacob", "Alex", "Sophie"] },
  { id: "white", name: "Team White", short: "WHT", colour: "#ffffff", members: ["Sam", "Freddie", "Maggie", "Loran"] }
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
  totalHoles: TOTAL_HOLES
};

// Total = normal hole strokes + penalties - challenge deductions.
// Keeping adjustments separate makes the scorecard easy to audit.
export function readTeamScore(teamRecord = {}) {
  const holeScores = teamRecord.holeScores || {};
  const recordedScores = Object.values(holeScores)
    .map(Number)
    .filter(Number.isFinite);
  const base = recordedScores.reduce((sum, n) => sum + n, 0);
  const penalties = Number(teamRecord.penalties || 0);
  const challenges = Number(teamRecord.challenges || 0);
  const hasActivity = recordedScores.length > 0 || penalties !== 0 || challenges !== 0;
  return {
    holeScores,
    base,
    penalties,
    challenges,
    total: base + penalties - challenges,
    holesPlayed: Number(teamRecord.holesPlayed || 0),
    hasActivity
  };
}
