"use client";

import { useEffect } from "react";
import { setGlobalTheme } from "@atlaskit/tokens/set-global-theme";

export function AtlassianTheme() {
  useEffect(() => {
    void setGlobalTheme({
      colorMode: "light",
      light: "light",
      dark: "dark",
      spacing: "spacing",
      typography: "typography",
      shape: "shape",
    });
  }, []);

  return null;
}
