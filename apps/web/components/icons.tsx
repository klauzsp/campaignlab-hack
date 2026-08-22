import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const SparkIcon = (props: Props) => <svg {...base} {...props}><path d="m12 3-1.2 4.1a5.2 5.2 0 0 1-3.6 3.6L3 12l4.2 1.3a5.2 5.2 0 0 1 3.6 3.6L12 21l1.2-4.1a5.2 5.2 0 0 1 3.6-3.6L21 12l-4.2-1.3a5.2 5.2 0 0 1-3.6-3.6L12 3Z" /></svg>;
export const SearchIcon = (props: Props) => <svg {...base} {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
export const FileIcon = (props: Props) => <svg {...base} {...props}><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
export const ArrowIcon = (props: Props) => <svg {...base} {...props}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
export const CheckIcon = (props: Props) => <svg {...base} {...props}><path d="m5 12 4 4L19 6" /></svg>;
export const ExternalIcon = (props: Props) => <svg {...base} {...props}><path d="M15 4h5v5M13 11l7-7M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></svg>;
export const LayersIcon = (props: Props) => <svg {...base} {...props}><path d="m12 3-9 5 9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>;
