export type ViewFace = "front" | "right" | "back" | "left" | "top" | "bottom";
export type ViewArrow = "up" | "down" | "left" | "right";

const sides: ViewFace[] = ["front", "right", "back", "left"];

export function nearestFace(x: number, y: number, z: number): ViewFace {
  if (Math.abs(y) > Math.max(Math.abs(x), Math.abs(z))) return y > 0 ? "top" : "bottom";
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? "right" : "left";
  return z >= 0 ? "front" : "back";
}

export function nextFace(face: ViewFace, arrow: ViewArrow, lastSide: ViewFace): { face: ViewFace; lastSide: ViewFace } {
  if (arrow === "left" || arrow === "right") {
    const side = face === "top" || face === "bottom" ? lastSide : face;
    const next = sides[(sides.indexOf(side) + (arrow === "right" ? 1 : 3)) % 4];
    return { face: next, lastSide: next };
  }
  if (face === "top") return arrow === "up"
    ? { face: sides[(sides.indexOf(lastSide) + 2) % 4], lastSide }
    : { face: lastSide, lastSide };
  if (face === "bottom") return arrow === "down"
    ? { face: sides[(sides.indexOf(lastSide) + 2) % 4], lastSide }
    : { face: lastSide, lastSide };
  if (face === sides[(sides.indexOf(lastSide) + 2) % 4]) {
    return { face: arrow === "up" ? "bottom" : "top", lastSide };
  }
  return { face: arrow === "up" ? "top" : "bottom", lastSide: face };
}

export function faceVector(face: ViewFace, lastSide: ViewFace): [number, number, number] {
  const side = face === "top" || face === "bottom" ? lastSide : face;
  const [x, , z] = faceVectorForSide(side);
  if (face === "top") return [x * 0.001, 1, z * 0.001];
  if (face === "bottom") return [x * 0.001, -1, z * 0.001];
  return [x, 0, z];
}

function faceVectorForSide(face: ViewFace): [number, number, number] {
  switch (face) {
    case "right": return [1, 0, 0];
    case "back": return [0, 0, -1];
    case "left": return [-1, 0, 0];
    default: return [0, 0, 1];
  }
}
