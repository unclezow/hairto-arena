'use client';

/* Background islands share cached GLTF geometry; only their transforms animate. */
import { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { Group, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function scatterPlatforms() {
  let seed = 841;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 8 }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const depth = 9 + random() * 15;
    const level = Math.floor(index / 2);
    const screenY = [-2.9, -0.5, 1.55, 3.4, 3.8][level]! + (random() - 0.5) * 0.7;
    const x = level === 4 ? side * (1.7 + random() * 1.5) : side * (5.8 + random() * 2.3);
    return {
      x,
      // Compensate for the downward camera angle, scattering across the visible valley.
      y: (screenY - depth * 0.335) / 0.943,
      z: -depth,
      scale: level === 4 ? 0.22 + random() * 0.08 : 0.28 + random() * 0.25,
      rotation: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      speed: 0.2 + random() * 0.2,
    };
  });
}

const PLATFORMS = scatterPlatforms();

export function ArenaEnvironment({ playing }: { playing: boolean }) {
  const sources = useLoader(GLTFLoader, ['/arena/island-a.glb?v=2', '/arena/island-b.glb?v=2']);
  const root = useRef<Group>(null);
  const time = useRef(0);
  const islands = useMemo(
    () =>
      PLATFORMS.map((platform, index) => {
        const object = sources[index % sources.length]!.scene.clone(true);
        object.traverse((node) => {
          if (node instanceof Mesh) {
            node.castShadow = false;
            node.receiveShadow = false;
          }
        });
        object.position.set(platform.x, platform.y, platform.z);
        object.scale.set(
          platform.scale,
          platform.scale * (0.8 + (index % 3) * 0.16),
          platform.scale,
        );
        object.rotation.y = platform.rotation;
        return object;
      }),
    [sources],
  );

  useFrame((_, delta) => {
    if (!playing || !root.current) return;
    time.current += Math.min(delta, 0.05);
    islands.forEach((island, index) => {
      const platform = PLATFORMS[index]!;
      const t = time.current * platform.speed + platform.phase;
      island.position.y = platform.y + Math.sin(t) * 0.18;
      island.position.x = platform.x + Math.cos(t * 0.7) * 0.09;
      island.rotation.y = platform.rotation + Math.sin(t * 0.4) * 0.1;
      island.rotation.z = Math.sin(t * 0.65) * 0.035;
    });
  });

  return (
    <group ref={root} name="Distant scattered floating platforms">
      {islands.map((island, index) => (
        <primitive key={index} object={island} dispose={null} />
      ))}
    </group>
  );
}
