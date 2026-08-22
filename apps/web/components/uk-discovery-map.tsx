"use client";

import { useState } from "react";

type Region = { name: string; shortName: string; x: number; y: number; councils: string[] };

const regions: Region[] = [
  { name: "Scotland", shortName: "Scotland", x: 340, y: 460, councils: ["Glasgow", "Edinburgh", "Aberdeen"] },
  { name: "North East England", shortName: "North East", x: 435, y: 602, councils: ["Newcastle upon Tyne", "Sunderland", "Durham"] },
  { name: "North West England", shortName: "North West", x: 370, y: 740, councils: ["Manchester", "Liverpool", "Lancashire"] },
  { name: "Yorkshire and the Humber", shortName: "Yorkshire", x: 439, y: 720, councils: ["Leeds", "Sheffield", "York"] },
  { name: "Wales", shortName: "Wales", x: 310, y: 870, councils: ["Cardiff", "Swansea", "Newport"] },
  { name: "West Midlands", shortName: "West Midlands", x: 419, y: 851, councils: ["Birmingham", "Coventry", "Wolverhampton"] },
  { name: "East Midlands", shortName: "East Midlands", x: 463, y: 805, councils: ["Nottingham", "Leicester", "Derby"] },
  { name: "East of England", shortName: "East", x: 539, y: 880, councils: ["Norfolk", "Suffolk", "Cambridgeshire"] },
  { name: "London", shortName: "London", x: 524, y: 949, councils: ["Wandsworth", "Camden", "Westminster"] },
  { name: "South East England", shortName: "South East", x: 538, y: 995, councils: ["Kent", "Brighton and Hove", "Oxfordshire"] },
  { name: "South West England", shortName: "South West", x: 340, y: 1015, councils: ["Bristol", "Cornwall", "Plymouth"] },
];

function questionFor(region: Region) {
  return `Give me a representative briefing on recent council priorities, service pressures and policy activity across ${region.name}. Use recent decisions and minuted meetings from ${region.councils.join(", ")} as examples, and distinguish formal decisions from discussion.`;
}

export function UkDiscoveryMap({ onExplore, disabled = false }: { onExplore: (question: string) => void; disabled?: boolean }) {
  const [selected, setSelected] = useState(regions[8]);
  const launch = (region: Region) => { if (!disabled) onExplore(questionFor(region)); };

  return <section className="uk-discovery" aria-label="Explore council activity by UK region">
    <div className="map-stage">
      <svg className="uk-map" viewBox="0 0 650 1125" role="img" aria-label="Interactive map of UK regions">
        <image href="/uk-outline.svg" width="650" height="1125" />
        {regions.map((region) => { const active = selected.name === region.name; return <g key={region.name} className={`map-marker${active ? " active" : ""}`} role="button" tabIndex={0} aria-label={`Investigate ${region.name}`} onMouseEnter={() => setSelected(region)} onFocus={() => setSelected(region)} onClick={() => launch(region)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); launch(region); } }}><circle className="marker-pulse" cx={region.x} cy={region.y} r="27" /><circle className="marker-dot" cx={region.x} cy={region.y} r="10" />{active && <text x={region.x + (region.x > 500 ? -24 : 24)} y={region.y - 22} textAnchor={region.x > 500 ? "end" : "start"}>{region.shortName}</text>}</g>; })}
      </svg>
    </div>
  </section>;
}
