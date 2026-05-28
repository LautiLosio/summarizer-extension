import backSvg from "../icons/back.svg";
import copySvg from "../icons/copy.svg";
import databaseSvg from "../icons/database.svg";
import externalLinkSvg from "../icons/external-link.svg";
import newSessionSvg from "../icons/new-session.svg";
import refreshSvg from "../icons/refresh.svg";
import saveSvg from "../icons/save.svg";
import startSvg from "../icons/start.svg";
import stopSvg from "../icons/stop.svg";
import xSvg from "../icons/x.svg";

const ICON_SVGS = {
  back: backSvg,
  copy: copySvg,
  database: databaseSvg,
  "external-link": externalLinkSvg,
  "new-session": newSessionSvg,
  refresh: refreshSvg,
  save: saveSvg,
  start: startSvg,
  stop: stopSvg,
  x: xSvg,
};

const parser = new DOMParser();

export function createFilledIcon(name) {
  const source = ICON_SVGS[name];
  if (!source) return null;

  const doc = parser.parseFromString(source, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg") return null;

  const icon = document.importNode(svg, true);
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  return icon;
}
