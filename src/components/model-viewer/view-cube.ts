export type ViewFace = "front" | "right" | "back" | "left" | "top" | "bottom";

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
