"use client";

import { useState } from "react";

type Region = { name: string; shortName: string; x: number; y: number; councils: string[] };

const regions: Region[] = [
  { name: "Scotland", shortName: "Scotland", x: 213, y: 125, councils: ["Glasgow", "Edinburgh", "Aberdeen"] },
  { name: "North East England", shortName: "North East", x: 268, y: 241, councils: ["Newcastle upon Tyne", "Sunderland", "Durham"] },
  { name: "North West England", shortName: "North West", x: 210, y: 281, councils: ["Manchester", "Liverpool", "Lancashire"] },
  { name: "Yorkshire and the Humber", shortName: "Yorkshire", x: 263, y: 292, councils: ["Leeds", "Sheffield", "York"] },
  { name: "Wales", shortName: "Wales", x: 164, y: 363, councils: ["Cardiff", "Swansea", "Newport"] },
  { name: "West Midlands", shortName: "West Midlands", x: 226, y: 355, councils: ["Birmingham", "Coventry", "Wolverhampton"] },
  { name: "East Midlands", shortName: "East Midlands", x: 267, y: 345, councils: ["Nottingham", "Leicester", "Derby"] },
  { name: "East of England", shortName: "East", x: 305, y: 375, councils: ["Norfolk", "Suffolk", "Cambridgeshire"] },
  { name: "London", shortName: "London", x: 302, y: 427, councils: ["Wandsworth", "Camden", "Westminster"] },
  { name: "South East England", shortName: "South East", x: 326, y: 449, councils: ["Kent", "Brighton and Hove", "Oxfordshire"] },
  { name: "South West England", shortName: "South West", x: 218, y: 473, councils: ["Bristol", "Cornwall", "Plymouth"] },
];

function questionFor(region: Region) {
  return `Give me a representative briefing on recent council priorities, service pressures and policy activity across ${region.name}. Use recent decisions and minuted meetings from ${region.councils.join(", ")} as examples, and distinguish formal decisions from discussion.`;
}

export function UkDiscoveryMap({ onExplore, disabled = false }: { onExplore: (question: string) => void; disabled?: boolean }) {
  const [selected, setSelected] = useState(regions[8]);
  const launch = (region: Region) => { if (!disabled) onExplore(questionFor(region)); };

  return <section className="uk-discovery" aria-label="Explore council activity by UK region">
    <div className="map-stage">
      <svg className="uk-map" viewBox="55 25 305 490" role="img" aria-label="Interactive map of UK regions">
        <defs><linearGradient id="atlas-land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#579dff" /><stop offset="1" stopColor="#6e5dc6" /></linearGradient><filter id="atlas-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path className="uk-land" d="M205 34c24 6 30 26 39 40l-11 21 23 17-12 22 25 18-15 20 17 21-19 18c17 19 24 37 28 57 7 30 22 53 37 76 14 22 12 43 29 62 18 20 10 40-11 51l-30 7-20 21-28 17-29 8-18-16 20-21 27-15 16-24-20-20-11-25-23-17-12-25-25-6-12-20-24 7-18-16 7-22 23-18 16-25-11-20 13-22-14-20 13-20-15-19 12-20-11-20 18-15-8-21 20-13-4-20 20-14z" />
        <path className="uk-land secondary" d="M77 245c18-8 35 2 43 17l-4 22 11 18-12 22-25 8-22-13-6-25 8-17-3-17z" />
        <path className="uk-island" d="M151 70l8-12 8 9-5 15zM278 194l9-7 5 10-8 9z" />
        {regions.map((region) => { const active = selected.name === region.name; return <g key={region.name} className={`map-marker${active ? " active" : ""}`} role="button" tabIndex={0} aria-label={`Investigate ${region.name}`} onMouseEnter={() => setSelected(region)} onFocus={() => setSelected(region)} onClick={() => launch(region)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); launch(region); } }}><circle className="marker-pulse" cx={region.x} cy={region.y} r="13" /><circle className="marker-dot" cx={region.x} cy={region.y} r="5" />{active && <text x={region.x + (region.x > 285 ? -12 : 12)} y={region.y - 11} textAnchor={region.x > 285 ? "end" : "start"}>{region.shortName}</text>}</g>; })}
      </svg>
    </div>
  </section>;
}
