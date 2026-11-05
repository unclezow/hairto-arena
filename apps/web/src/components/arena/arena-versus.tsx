'use client';

/* Skeletal animation and transforms are intentionally mutable in the render loop. */
/* eslint-disable react-hooks/immutability */
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { AnimationMixer, Box3, Group, OrthographicCamera } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import './arena-versus.css';
import { SceneReady } from './scene-ready';
import { hiddenAccessories, type OwnedFighter } from '../play/mock-fighters';

function Portrait({
  kind,
  reducedMotion,
}: {
  kind: OwnedFighter['kind'] | 'Barbarian';
  reducedMotion: boolean;
}) {
  const gltf = useLoader(GLTFLoader, `/arena/characters/${kind}.glb`);
  const group = useRef<Group>(null);
  const direction = kind === 'Barbarian' ? -1 : 1;
  const { camera, size } = useThree();
  const model = useMemo(() => {
    const object = clone(gltf.scene);
    const hidden = hiddenAccessories(kind);
    object.traverse((node) => {
      if (hidden.includes(node.name)) node.visible = false;
    });
    const bounds = new Box3().setFromObject(object);
    const scale = 3.8 / (bounds.max.y - bounds.min.y);
    object.scale.setScalar(scale);
    object.position.y = -bounds.min.y * scale;
    return object;
  }, [gltf.scene, kind]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  useEffect(() => {
    const idle = gltf.animations.find((clip) => clip.name === 'Idle');
    if (idle) mixer.clipAction(idle).play();
    mixer.update(0);
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [gltf.animations, mixer, model]);
  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    group.current.position.x =
      ((-direction * size.width) / (camera as OrthographicCamera).zoom) * 0.3;
    group.current.position.y = reducedMotion
      ? 0
      : Math.sin(clock.elapsedTime * 1.5 + direction) * 0.035;
    group.current.rotation.y =
      direction * (0.64 + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.7) * 0.035));
    if (!reducedMotion) mixer.update(Math.min(delta, 0.05));
  });
  return (
    <group ref={group} rotation={[0, direction * 0.64, 0]}>
      <primitive object={model} dispose={null} />
    </group>
  );
}

function PortraitCamera() {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const ortho = camera as OrthographicCamera;
    ortho.position.set(0, 2.1, 12);
    ortho.lookAt(0, 1.9, 0);
    ortho.zoom = Math.min(size.width / 9.4, size.height / 4.8);
    ortho.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  return null;
}

export function ArenaVersus({
  player,
  reducedMotion,
  onReady,
}: {
  player: OwnedFighter;
  reducedMotion: boolean;
  onReady: () => void;
}) {
  return (
    <div className="arena-versus-screen">
      <header className="arena-versus-header">
        <span>HAIRTO ARENA</span>
        <div>
          <i />
          THE FLOATING GROUNDS
          <i />
        </div>
      </header>
      <div className="arena-versus-stage">
        <div className="arena-versus-aura arena-versus-aura-left" aria-hidden="true" />
        <div className="arena-versus-aura arena-versus-aura-right" aria-hidden="true" />
        <div className="arena-versus-portraits" aria-hidden="true">
          <Canvas
            orthographic
            camera={{ position: [0, 2.1, 12], zoom: 60, near: 0.1, far: 40 }}
            dpr={[1, 1.5]}
            frameloop={reducedMotion ? 'demand' : 'always'}
            gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
          >
            <ambientLight intensity={1.5} />
            <hemisphereLight args={['#f2f1d9', '#46563a', 1.8]} />
            <directionalLight position={[-4, 6, 7]} intensity={3} />
            <directionalLight position={[5, 3, -4]} intensity={3.5} color="#e5c481" />
            <PortraitCamera />
            <Suspense fallback={null}>
              <Portrait kind={player.kind} reducedMotion={reducedMotion} />
              <Portrait kind="Barbarian" reducedMotion={reducedMotion} />
              <SceneReady onReady={onReady} />
            </Suspense>
          </Canvas>
        </div>
        <div
          className="arena-versus-center"
          role="status"
          aria-label={`${player.title} versus The Berserker`}
        >
          <svg viewBox="0 0 120 220" fill="none" aria-hidden="true">
            <path d="m70 0-38 90 35-8-30 65 34-9-25 82" stroke="currentColor" strokeWidth="1" />
            <path
              d="m74 7-29 75 35-8-30 65 34-9-32 83"
              stroke="currentColor"
              strokeOpacity=".15"
              strokeWidth="5"
            />
            <path d="m60 30 6 8-6 8-6-8Zm0 144 6 8-6 8-6-8Z" stroke="currentColor" />
          </svg>
          <span>VS</span>
          <small>ROUND 01</small>
        </div>
      </div>
      <div className="arena-versus-names">
        <div className="arena-versus-fighter arena-versus-player">
          <span className="arena-versus-tag">
            P1 <i /> YOU
          </span>
          <h2>{player.title}</h2>
          <p>
            {player.kind.toUpperCase()} <span>◆</span> {player.motto}
          </p>
        </div>
        <span className="arena-versus-match">
          MATCH FOUND <i />
        </span>
        <div className="arena-versus-fighter arena-versus-opponent">
          <span className="arena-versus-tag">
            CPU <i /> OPPONENT
          </span>
          <h2>The Berserker</h2>
          <p>
            BARBARIAN <span>◆</span> FURY & FORCE
          </p>
        </div>
      </div>
      <div className="arena-versus-bottom-rule" aria-hidden="true">
        <span />◆<span />
      </div>
    </div>
  );
}
