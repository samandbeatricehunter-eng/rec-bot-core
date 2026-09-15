import { useEffect, useState } from "react";

/** Matches the --bp-md (768px) token from tokens.css — kept as a literal here since CSS
 * custom properties aren't readable from a media-query condition. */
export function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpointPx);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpointPx]);
  return isMobile;
}
