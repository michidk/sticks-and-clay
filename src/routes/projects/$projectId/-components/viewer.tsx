import { useEffect, useRef, useState } from "react";
import { ViewerSkeleton } from "../../../../components/loading";
export default function Viewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let stop = false,
      cleanup = () => {};
    setError("");
    setLoading(true);
    Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(([T, { GLTFLoader }, { OrbitControls }]) => {
        if (stop || !host.current) return;
        const el = host.current;
        const scene = new T.Scene();
        scene.background = new T.Color("#e9ede8");
        const camera = new T.PerspectiveCamera(38, 1, 0.01, 10000);
        const renderer = new T.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        el.appendChild(renderer.domElement);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        scene.add(new T.HemisphereLight(0xffffff, 0x777966, 3));
        const key = new T.DirectionalLight(0xffffff, 4);
        key.position.set(5, 8, 7);
        scene.add(key);
        let frame = 0;
        const resize = () => {
          renderer.setSize(el.clientWidth, el.clientHeight);
          camera.aspect = el.clientWidth / el.clientHeight;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        resize();
        new GLTFLoader().load(
          url,
          (g) => {
            if (stop) {
              g.scene.traverse((o: any) => {
                o.geometry?.dispose();
                if (o.material)
                  (Array.isArray(o.material)
                    ? o.material
                    : [o.material]
                  ).forEach((m: any) => m.dispose());
              });
              return;
            }
            scene.add(g.scene);
            const box = new T.Box3().setFromObject(g.scene);
            const size = box.getSize(new T.Vector3()).length();
            const center = box.getCenter(new T.Vector3());
            controls.target.copy(center);
            camera.position
              .copy(center)
              .add(new T.Vector3(size * 0.9, size * 0.6, size * 0.9));
            camera.near = size / 1000;
            camera.far = size * 100;
            camera.updateProjectionMatrix();
            controls.update();
            setLoading(false);
          },
          undefined,
          (e) => {
            if (!stop) setError("Could not load this GLB: " + String(e));
          },
        );
        const animate = () => {
          frame = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          scene.traverse((o: any) => {
            o.geometry?.dispose();
            if (o.material)
              (Array.isArray(o.material) ? o.material : [o.material]).forEach(
                (m: any) => {
                  Object.values(m).forEach((v: any) => {
                    if (v?.isTexture) v.dispose();
                  });
                  m.dispose();
                },
              );
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch((e) => setError(String(e)));
    return () => {
      stop = true;
      cleanup();
    };
  }, [url]);
  return (
    <>
      <div ref={host} className="viewer" data-loaded={!loading}>
        {loading && !error && <ViewerSkeleton overlay />}
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : (
        <p className="viewer-hint">
          {loading ? "" : "Drag to orbit · Scroll to zoom"}
        </p>
      )}
    </>
  );
}
