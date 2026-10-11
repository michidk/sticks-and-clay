import { ViewerErrorBoundary } from "./viewer-error-boundary";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useGLTF, useTexture } from "@react-three/drei";
import {
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { fileUrl, json, request } from "../lib/client";

type SavedModel = { id: string; name: string; artifacts?: { glb?: string } };
type Props = { files: string[]; projectId: string; materialId: string };
function AssignedModel({
  src,
  material,
  slot,
  onSlots,
}: {
  src: string;
  material: MeshStandardMaterial;
  slot: string;
  onSlots: (v: string[]) => void;
}) {
  const { scene } = useGLTF(src);
  const copy = useMemo(() => clone(scene), [scene]);
  const slots = useMemo(() => {
    const names = new Set<string>(),
      invalid = new Set<string>();
    copy.traverse((o) => {
      if (o instanceof Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          names.add(m.name);
          if (!o.geometry.getAttribute("uv")) invalid.add(m.name);
        }
      }
    });
    return [...names].filter((n) => !invalid.has(n));
  }, [copy]);
  useEffect(() => onSlots(slots), [slots, onSlots]);
  useEffect(() => {
    const previous: { mesh: Mesh; material: Mesh["material"] }[] = [];
    copy.traverse((o) => {
      if (o instanceof Mesh) {
        previous.push({ mesh: o, material: o.material });
        const replace = (m: MeshStandardMaterial) =>
          m.name === slot && o.geometry.getAttribute("uv") ? material : m;
        o.material = Array.isArray(o.material)
          ? o.material.map(replace)
          : replace(o.material);
      }
    });
    return () => {
      for (const item of previous) item.mesh.material = item.material;
    };
  }, [copy, material, slot]);
  return <primitive object={copy} dispose={null} />;
}
function Surface({
  base,
  shape,
  repeat,
  normalStrength,
  displacement,
  channel,
  src,
  slot,
  onSlots,
  tileMetres,
}: {
  base: string;
  shape: string;
  repeat: number;
  normalStrength: number;
  displacement: number;
  channel: string;
  src?: string;
  slot: string;
  onSlots: (v: string[]) => void;
  tileMetres: number;
}) {
  const originals = useTexture(
    ["albedo", "normal", "roughness", "metallic", "height", "ao"].map((n) =>
      fileUrl(`${base}/${n}.png`),
    ),
  );
  const maps = useMemo(
    () =>
      originals.map((t, i) => {
        const copy = t.clone();
        copy.colorSpace = i === 0 ? SRGBColorSpace : NoColorSpace;
        copy.flipY = !src;
        copy.wrapS = copy.wrapT = RepeatWrapping;
        return copy;
      }),
    [...originals, Boolean(src)],
  );
  useEffect(() => {
    for (const t of maps) {
      t.repeat.set(repeat, repeat);
      t.needsUpdate = true;
    }
  }, [maps, repeat]);
  useEffect(() => () => maps.forEach((t) => t.dispose()), [maps]);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: maps[0],
        normalMap: maps[1],
        roughnessMap: maps[2],
        metalnessMap: maps[3],
        aoMap: maps[5],
        metalness: 1,
        roughness: 1,
      }),
    [maps],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.normalScale.set(normalStrength, normalStrength);
  material.displacementMap = src ? null : maps[4];
  material.displacementScale = displacement;
  material.displacementBias = -displacement / 2;
  const index = [
    "albedo",
    "normal",
    "roughness",
    "metallic",
    "height",
    "ao",
  ].indexOf(channel);
  const displayMap = useMemo(() => {
    const texture = maps[index]?.clone();
    if (texture) texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [maps, index]);
  useEffect(() => () => displayMap?.dispose(), [displayMap]);
  if (src)
    return (
      <AssignedModel
        src={src}
        material={material}
        slot={slot}
        onSlots={onSlots}
      />
    );
  return (
    <mesh rotation={shape === "plane" ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
      {shape === "sphere" ? (
        <sphereGeometry
          args={[(tileMetres * repeat) / (2 * Math.PI), 96, 64]}
        />
      ) : (
        <planeGeometry
          args={[tileMetres * repeat, tileMetres * repeat, 96, 96]}
        />
      )}
      {index >= 0 ? (
        <meshBasicMaterial map={displayMap} toneMapped={false} />
      ) : (
        <primitive object={material} attach="material" />
      )}
    </mesh>
  );
}
export function MaterialViewer({ files, projectId, materialId }: Props) {
  const albedo = files.find((f) => f.endsWith("/albedo.png"));
  const [open, setOpen] = useState(false),
    [shape, setShape] = useState("sphere"),
    [repeat, setRepeat] = useState(2),
    [light, setLight] = useState(45),
    [normal, setNormal] = useState(1),
    [height, setHeight] = useState(0),
    [channel, setChannel] = useState("lit");
  const [tileMetres, setTileMetres] = useState(1);
  useEffect(() => {
    if (!open || !albedo) return;
    let active = true;
    fetch(fileUrl(albedo.replace(/albedo\.png$/, "material.json")))
      .then((r) => r.json())
      .then((m) => {
        if (active) {
          setTileMetres(m.physicalTileMetres);
          setHeight((m.heightWindowMm[1] - m.heightWindowMm[0]) / 1000);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, albedo]);
  const [models, setModels] = useState<SavedModel[]>([]),
    [modelId, setModelId] = useState("none"),
    [slots, setSlots] = useState<string[]>([]),
    [slot, setSlot] = useState(""),
    [error, setError] = useState(""),
    [assignment, setAssignment] = useState<string>(),
    [result, setResult] = useState<{
      status: string;
      error?: string;
      files: string[];
    }>();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    request<{ models: SavedModel[] }>(`projects/${projectId}`)
      .then((data) => {
        if (alive) setModels(data.models.filter((m) => m.artifacts?.glb));
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, projectId]);
  useEffect(() => {
    if (!assignment) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      request<{ status: string; error?: string; files: string[] }>(
        `workshop-jobs/${assignment}`,
      )
        .then((job) => {
          if (active) {
            setResult(job);
            if (!["done", "failed", "cancelled"].includes(job.status))
              timer = setTimeout(poll, 2000);
          }
        })
        .catch((e) => active && setError(e.message));
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [assignment]);
  if (!albedo) return null;
  const source = models.find((m) => m.id === modelId),
    base = albedo.slice(0, albedo.lastIndexOf("/"));
  async function exportAssigned() {
    try {
      const job = await request<{ id: string }>(
        `models/${modelId}/material-assignment`,
        json({ materialVersionId: materialId, slot, repeat }),
      );
      setAssignment(job.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? "Close material viewer" : "Inspect material in 3D"}
      </Button>
      {open && (
        <>
          <div
            className="h-80 overflow-hidden rounded border"
            style={{ background: "#e9ede8" }}
          >
            <ViewerErrorBoundary key={modelId + materialId}>
              <Canvas
                camera={{ position: [3, 2, 3], fov: 45 }}
                fallback={
                  <p>
                    3D preview is unavailable; maps and static review remain
                    available below.
                  </p>
                }
              >
                <ambientLight intensity={0.6} />
                <directionalLight
                  intensity={3}
                  position={[
                    Math.cos((light * Math.PI) / 180) * 4,
                    3,
                    Math.sin((light * Math.PI) / 180) * 4,
                  ]}
                />
                <Suspense fallback={null}>
                  <Bounds fit clip observe margin={1.3}>
                    <Surface
                      base={base}
                      shape={shape}
                      repeat={repeat}
                      normalStrength={normal}
                      displacement={height}
                      channel={channel}
                      src={
                        source?.artifacts?.glb
                          ? fileUrl(source.artifacts.glb)
                          : undefined
                      }
                      slot={slot}
                      onSlots={setSlots}
                      tileMetres={tileMetres}
                    />
                  </Bounds>
                </Suspense>
                <OrbitControls makeDefault />
              </Canvas>
            </ViewerErrorBoundary>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Label>
              Shape
              <Select value={shape} onValueChange={setShape}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sphere">Sphere</SelectItem>
                  <SelectItem value="plane">Plane</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label>
              Channel
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "lit",
                    "albedo",
                    "normal",
                    "roughness",
                    "metallic",
                    "height",
                    "ao",
                  ].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label>
              Repeat
              <Input
                type="number"
                min={1}
                max={8}
                value={repeat}
                onChange={(e) =>
                  setRepeat(Math.min(8, Math.max(1, Number(e.target.value))))
                }
              />
            </Label>
            <Label>
              Light angle
              <Input
                type="range"
                min={0}
                max={360}
                value={light}
                onChange={(e) => setLight(Number(e.target.value))}
              />
            </Label>
            <Label>
              Normal strength
              <Input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={normal}
                onChange={(e) => setNormal(Number(e.target.value))}
              />
            </Label>
            <Label>
              Preview relief (metres)
              <Input
                type="range"
                min={0}
                max={0.1}
                step={0.001}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </Label>
            <Label>
              Saved model
              <Select
                value={modelId}
                onValueChange={(id) => {
                  setModelId(id);
                  setSlot("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Preview shape</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            {source && (
              <Label>
                Material slot
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {slots.filter(Boolean).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}
          </div>
          {source && (
            <>
              <p className="text-sm">
                Assignment uses existing UVs and the chosen repeat count. UVs
                must already provide the intended physical scale; meshes without
                UVs cannot receive this material.
              </p>
              <Button disabled={!slot} onClick={() => void exportAssigned()}>
                Export model with this material
              </Button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {result && (
            <p role="status">
              {result.error || `Assignment: ${result.status}`}
            </p>
          )}
          {result?.files.map((key) => (
            <a
              key={key}
              className="mr-3 underline"
              download
              href={fileUrl(key)}
            >
              {key.split("/").pop()}
            </a>
          ))}
        </>
      )}
    </div>
  );
}
