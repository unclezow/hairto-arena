'use client';

/* Effect objects are renderer-owned, updated without React renders per frame. */
/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DataTexture,
  RGBAFormat,
  LinearFilter,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  ShaderMaterial,
} from 'three';
import {
  ATTACKS,
  clamp01,
  directionFor,
  easeOut,
  homeFor,
  elevationFor,
  heroScaleFor,
  impactEnvelope,
  smooth,
  type AttackRequest,
  type CombatRuntime,
  type CombatStage,
} from './arena-combat';

export type CombatRef = RefObject<CombatRuntime>;

export function CombatDriver({
  attack,
  runtime,
  playing,
  onImpact,
  onFinish,
  onStage,
}: {
  attack: AttackRequest | null;
  runtime: CombatRef;
  playing: boolean;
  onImpact: (attack: AttackRequest) => void;
  onFinish: (id: number) => void;
  onStage: (stage: CombatStage) => void;
}) {
  useEffect(() => {
    runtime.current.request = attack;
    runtime.current.time = 0;
    runtime.current.impacted = false;
    runtime.current.released = false;
    runtime.current.hitStop = 0;
  }, [attack, runtime]);
  useFrame((_, delta) => {
    const state = runtime.current;
    if (!state.request || !playing) return;
    if (state.hitStop > 0) {
      state.hitStop = Math.max(0, state.hitStop - Math.min(delta, 0.06));
      return;
    }
    const request = state.request;
    const spec = ATTACKS[request.kind];
    state.time += Math.min(delta, 0.06);
    if (!state.released && state.time >= spec.release) {
      state.released = true;
      onStage('release');
    }
    if (!state.impacted && state.time >= spec.impact) {
      state.impacted = true;
      state.hitStop =
        request.kind === 'ultimate' ? 0.105 : request.kind === 'medium' ? 0.07 : 0.045;
      onImpact(request);
      onStage('impact');
    }
    if (state.time >= spec.duration) {
      state.request = null;
      onStage('idle');
      onFinish(request.id);
    }
  }, -10);
  return null;
}

function crescentGeometry(radius: number, width: number, length: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const segments = 56;
  for (let i = 0; i < segments; i++) {
    const a = -length / 2 + (length * i) / segments,
      b = -length / 2 + (length * (i + 1)) / segments;
    const edge = (angle: number, ratio: number) => {
      const taper = Math.sin(clamp01(ratio) * Math.PI) ** 0.7;
      const inner = radius - width * taper;
      return {
        outer: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
        inner: [Math.cos(angle) * inner, Math.sin(angle) * inner, 0],
      };
    };
    const p = edge(a, i / segments),
      q = edge(b, (i + 1) / segments);
    positions.push(...p.outer, ...p.inner, ...q.outer, ...q.outer, ...p.inner, ...q.inner);
    const u = i / segments,
      v = (i + 1) / segments;
    uvs.push(u, 0, u, 1, v, 0, v, 0, u, 1, v, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  return geometry;
}

const glowVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const glowFragment = `varying vec2 vUv; uniform vec3 tint; uniform float alpha;
 void main(){float r=length(vUv-.5)*2.;float halo=pow(max(0.,1.-r),2.6);float core=pow(max(0.,1.-r*2.4),3.);
 gl_FragColor=vec4(tint+vec3(core*.7),halo*alpha);}`;

function softParticleTexture() {
  const size = 64,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x - size / 2) / (size / 2), (y - size / 2) / (size / 2));
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(Math.max(0, 1 - r) ** 2.4 * 255);
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
const noiseGLSL = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}`;
function ribbonMaterial(color: string) {
  return new ShaderMaterial({
    uniforms: { tint: { value: new Color(color) }, time: { value: 0 }, alpha: { value: 1 } },
    vertexShader: glowVertex,
    fragmentShader: `varying vec2 vUv;uniform vec3 tint;uniform float time;uniform float alpha;${noiseGLSL}
    void main(){float n=noise(vUv*vec2(26.,7.)+vec2(-time*6.,time*2.));
    float edge=smoothstep(0.,.22,vUv.y)*smoothstep(1.,.7,vUv.y);
    float end=pow(max(0.,sin(vUv.x*3.14159)),.6);
    float body=edge*end*(.35+n*.65);float core=pow(max(0.,1.-abs(vUv.y-.52)*4.),3.);
    gl_FragColor=vec4(mix(tint,vec3(1.),core*.7),body*alpha);}`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

function energyMaterial(color: string, opacity = 1) {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

function BurstParticles({ runtime }: { runtime: CombatRef }) {
  const points = useRef<InstancedMesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const texture = useMemo(() => softParticleTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  const compact = useThree((s) => s.size.width < 600);
  const seeds = useMemo(
    () =>
      Array.from({ length: 88 }, (_, i) => {
        const a = i * 2.39996;
        const y = (((i * 37) % 89) / 89) * 2 - 1;
        return {
          x: Math.cos(a) * Math.sqrt(1 - y * y),
          y,
          z: Math.sin(a) * Math.sqrt(1 - y * y) * 0.65,
          speed: 1.4 + (i % 11) * 0.19,
          size: 0.45 + (i % 7) * 0.12,
        };
      }),
    [],
  );
  useFrame(() => {
    const mesh = points.current;
    if (!mesh) return;
    const { request, time } = runtime.current;
    if (!request) {
      mesh.visible = false;
      return;
    }
    const spec = ATTACKS[request.kind];
    const t = time - spec.impact;
    mesh.visible = t >= 0 && t < 1.35;
    if (!mesh.visible) return;
    const ultimate = request.kind === 'ultimate';
    const power = ultimate ? 1.7 : request.kind === 'medium' ? 1.3 : 0.9;
    const count = ultimate ? 88 : request.kind === 'medium' ? 68 : 36;
    const scale = heroScaleFor(compact);
    const elevation = elevationFor(compact);
    const dir = directionFor(request.attacker);
    mesh.position.set(-homeFor(request.attacker) - dir * 0.24, elevation + scale * 1.3, 0.55);
    seeds.forEach((seed, i) => {
      const age = Math.max(0, t - (i % 7) * 0.012);
      const lifetime = 0.35 + (i % 9) * 0.085;
      const distance = (age * seed.speed + 0.025) * power;
      dummy.position.set(
        (seed.x * 0.75 + dir * 0.38) * distance,
        seed.y * distance - age * age * 1.7,
        seed.z * distance,
      );
      dummy.rotation.set(-0.3, 0, seed.x * 4);
      const size =
        i < count && t >= (i % 7) * 0.012 ? Math.max(0, 1 - age / lifetime) * seed.size * power : 0;
      dummy.scale.set(size * (i % 5 === 0 ? 0.23 : 0.11), size * (i % 3 === 0 ? 0.42 : 0.14), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(
        i,
        new Color(
          ultimate
            ? i % 3
              ? '#f7d997'
              : '#dcb1ff'
            : request.kind === 'medium'
              ? i % 3
                ? '#a8f8ff'
                : '#ffffff'
              : '#ffe4a5',
        ),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (material.current) material.current.opacity = 1 - clamp01(t / 1.35);
  });
  return (
    <instancedMesh ref={points} args={[undefined, undefined, 88]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        ref={material}
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
        blending={AdditiveBlending}
      />
    </instancedMesh>
  );
}

export function CombatVfx({ runtime }: { runtime: CombatRef }) {
  const compact = useThree((s) => s.size.width < 600);
  const root = useRef<Group>(null);
  const charge = useRef<Group>(null);
  const basicSlash = useRef<Group>(null);
  const sigil = useRef<Group>(null);
  const shot = useRef<Group>(null);
  const hit = useRef<Group>(null);
  const beam = useRef<Group>(null);
  const blades = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const resources = useMemo(
    () => ({
      wave: crescentGeometry(0.95, 0.24, Math.PI * 1.5),
      basicArc: crescentGeometry(1.15, 0.29, Math.PI * 1.24),
      basicArcMaterial: ribbonMaterial('#ffe0a0'),
      basicArcTail: ribbonMaterial('#e8b96d'),
      ribbon: ribbonMaterial('#79d9ee'),
      ribbonTailA: ribbonMaterial('#79d9ee'),
      ribbonTailB: ribbonMaterial('#79d9ee'),
      ribbonTailC: ribbonMaterial('#79d9ee'),
      gold: energyMaterial('#ffe5a7'),
      white: energyMaterial('#f4fdff'),
      cyan: energyMaterial('#75e5ff'),
      purple: energyMaterial('#cb8bff'),
      softGold: energyMaterial('#ffd88e', 0.45),
      softCyan: energyMaterial('#8cf2ff', 0.42),
      softPurple: energyMaterial('#b786ff', 0.45),
      glow: new ShaderMaterial({
        uniforms: { tint: { value: new Color('#93eafa') }, alpha: { value: 1 } },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(resources).forEach((resource) => resource.dispose());
    },
    [resources],
  );
  useFrame(() => {
    if (!root.current) return;
    const { request, time: t } = runtime.current;
    root.current.visible = !!request;
    if (!request) return;
    resources.ribbon.uniforms.time!.value = t;
    resources.basicArcMaterial.uniforms.time!.value = t;
    resources.basicArcTail.uniforms.time!.value = t;
    if (basicSlash.current) {
      const group = basicSlash.current;
      const progress = clamp01((t - 0.62) / 0.48);
      group.visible = request.kind === 'basic' && t >= 0.62 && t < 1.1;
      const opacity = Math.sin(progress * Math.PI) ** 0.65;
      resources.basicArcMaterial.uniforms.alpha!.value = opacity * 1.6;
      resources.basicArcTail.uniforms.alpha!.value = opacity * 0.48;
      const slashDir = directionFor(request.attacker);
      const lift = elevationFor(compact);
      const fighterScale = heroScaleFor(compact);
      group.position.set(
        homeFor(request.attacker) + slashDir * 3.2 + slashDir * 0.9,
        lift + fighterScale * 1.3 + 0.1,
        0.8,
      );
      group.rotation.set(-0.28, slashDir === 1 ? 0 : Math.PI, -0.75 + smooth(progress) * 1.45);
      group.scale.set(1.5, 0.8, 1);
    }
    [resources.ribbonTailA, resources.ribbonTailB, resources.ribbonTailC].forEach(
      (material, index) => {
        material.uniforms.time!.value = t;
        material.uniforms.alpha!.value = [0.4, 0.2, 0.08][index];
      },
    );
    const kind = request.kind,
      spec = ATTACKS[kind],
      dir = directionFor(request.attacker);
    const scale = heroScaleFor(compact),
      elevation = elevationFor(compact);
    const start = homeFor(request.attacker),
      target = -start;
    const bodyY = elevation + scale * 1.3;
    const after = t - spec.impact;
    const pulse = impactEnvelope(t, spec.impact, kind === 'ultimate' ? 1.15 : 0.75);
    const isUlt = kind === 'ultimate';
    if (charge.current) {
      const g = charge.current;
      g.visible = kind !== 'basic' && t < spec.release + 0.08;
      g.position.set(start + dir * 0.36, bodyY + 0.3, 0.4);
      g.rotation.z = t * (isUlt ? 2.4 : 3.5) * dir;
      g.children.forEach((child, index) => {
        if (index >= 2) child.visible = isUlt || index === 2;
      });
      const size = (isUlt ? 1.15 : 0.82) * smooth(t / (isUlt ? 1.1 : 0.5));
      g.scale.setScalar(Math.max(0.001, size));
      resources.glow.uniforms.tint!.value.set(
        kind === 'basic' ? '#ffdaa0' : isUlt ? '#be82ff' : '#75e5ff',
      );
      resources.glow.uniforms.alpha!.value = 0.7 + Math.sin(t * 9) * 0.12;
    }
    if (sigil.current) {
      const g = sigil.current;
      g.visible = isUlt && t < spec.impact + 0.65;
      g.position.set(start, elevation + 0.06, 0);
      g.rotation.y = t * 0.9;
      const growth = smooth(t / 0.8) * (1 - clamp01((t - spec.impact) / 0.65));
      g.scale.setScalar(Math.max(0.001, growth));
    }
    if (shot.current) {
      const g = shot.current;
      const raw = clamp01((t - spec.release) / (spec.impact - spec.release));
      const p = Math.pow(raw, 1.35);
      g.visible = kind === 'medium' && t >= spec.release && t < spec.impact + 0.08;
      g.position.set(start + (target - start) * p, bodyY + 0.1 + Math.sin(p * Math.PI) * 0.3, 0.65);
      g.rotation.set(-0.3, 0, dir === 1 ? 0 : Math.PI);
      g.scale.setScalar(0.86 + Math.sin(p * Math.PI) * 0.22);
    }
    if (hit.current) {
      const g = hit.current;
      g.visible = after >= 0 && after < (isUlt ? 1.5 : 1);
      g.position.set(target - dir * 0.2, bodyY, 0.6);
      const size =
        (isUlt ? 1.6 : kind === 'medium' ? 1.2 : 0.65) *
        (0.25 + easeOut(after / (isUlt ? 0.65 : 0.45)));
      g.scale.setScalar(size);
      g.rotation.set(-0.3, 0, after * 0.7 * dir);
      if (after >= 0) resources.glow.uniforms.alpha!.value = Math.max(0, 1 - after / 0.4);
      g.children.forEach((child, i) => {
        child.visible = kind !== 'basic' || i === 0 || i === 1 || i === 4;
        if (child instanceof Mesh) {
          const material = child.material as MeshBasicMaterial;
          material.opacity = (i % 2 ? 0.28 : 0.55) * Math.max(0, 1 - after / (isUlt ? 0.85 : 0.4));
        }
      });
    }
    if (beam.current) {
      const g = beam.current;
      g.visible = isUlt && t > spec.impact - 0.15 && after < 0.24;
      g.position.set(target, elevation + 3.7, 0.15);
      const fade =
        t < spec.impact ? smooth((t - spec.impact + 0.22) / 0.22) : 1 - clamp01(after / 0.24);
      g.scale.set(fade, 1, fade);
    }
    if (blades.current) {
      const g = blades.current;
      g.visible = isUlt && t > 0.35 && after < 0.12;
      const release = clamp01((t - 1.55) / 0.95);
      g.children.forEach((blade, i) => {
        const angle = (i / 8) * Math.PI * 2 + t * 0.4;
        const radius = 1.3 * (1 - release);
        const originX = start + Math.cos(angle) * radius;
        const originY = bodyY + 1.4 + Math.sin(angle) * radius * 0.55;
        blade.position.set(
          originX + (target - originX) * release,
          originY + (bodyY - originY) * release + Math.sin(release * Math.PI) * 1.3,
          Math.sin(angle) * 0.4 + 0.4,
        );
        blade.rotation.set(0, 0, -dir * (0.2 + release * 1.4));
        blade.scale.setScalar(smooth((t - 0.35) / 0.45) * (1 - release * 0.3));
      });
    }
    if (light.current) {
      light.current.position.set(after >= 0 ? target : start, bodyY + 1.2, 1.5);
      light.current.color.set(kind === 'basic' ? '#ffe2a0' : isUlt ? '#c798ff' : '#8ceaff');
      light.current.intensity =
        (isUlt ? 35 : kind === 'medium' ? 20 : 7) * (pulse + (t < spec.release ? 0.25 : 0));
    }
  });
  return (
    <>
      <group ref={root} visible={false}>
        <group ref={basicSlash} visible={false}>
          <mesh geometry={resources.basicArc} material={resources.basicArcMaterial} />
          <mesh
            geometry={resources.basicArc}
            material={resources.basicArcTail}
            rotation={[0, 0, -0.14]}
            scale={[1.08, 1.13, 1]}
            position={[0, 0, -0.02]}
          />
        </group>
        <group ref={charge} visible={false}>
          <mesh rotation={[-0.3, 0, 0]} material={resources.glow}>
            <planeGeometry args={[3.8, 3.8]} />
          </mesh>
          <mesh material={resources.white}>
            <octahedronGeometry args={[0.18, 0]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              rotation={[i * 0.7, 0.6 + i * 0.8, i * 0.8]}
              material={i === 1 ? resources.purple : resources.cyan}
            >
              <torusGeometry args={[0.48 + i * 0.12, 0.016, 5, 56]} />
            </mesh>
          ))}
        </group>
        <group ref={sigil} visible={false}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {[1, 1.22, 1.7].map((r, i) => (
              <mesh key={r} material={i === 1 ? resources.purple : resources.gold}>
                <torusGeometry args={[r, 0.015, 5, 72]} />
              </mesh>
            ))}
            {[0, 1].map((i) => (
              <mesh key={i} rotation={[0, 0, i * Math.PI]} material={resources.softGold}>
                <ringGeometry args={[1.43, 1.46, 3]} />
              </mesh>
            ))}
            {Array.from({ length: 12 }, (_, i) => (
              <mesh
                key={i}
                position={[
                  Math.cos((i * Math.PI) / 6) * 1.48,
                  Math.sin((i * Math.PI) / 6) * 1.48,
                  0,
                ]}
                rotation={[0, 0, (i * Math.PI) / 6 + Math.PI / 4]}
                material={resources.white}
              >
                <planeGeometry args={[0.07, 0.16]} />
              </mesh>
            ))}
          </group>
        </group>
        <group ref={shot} visible={false}>
          <mesh geometry={resources.wave} material={resources.ribbon} />
          <mesh
            geometry={resources.wave}
            position={[-0.13, 0, 0.01]}
            scale={0.84}
            material={resources.ribbon}
          />
          <mesh material={resources.glow} position={[-0.25, 0, -0.02]}>
            <planeGeometry args={[3.8, 2.9]} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              geometry={resources.wave}
              position={[-0.22 - i * 0.23, 0, -0.02 - i * 0.01]}
              scale={0.95 - i * 0.15}
              material={[resources.ribbonTailA, resources.ribbonTailB, resources.ribbonTailC][i]}
            />
          ))}
        </group>
        <group ref={hit} visible={false}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.65, 0]}>
            <ringGeometry args={[0.75, 0.79, 64]} />
            <meshBasicMaterial
              color="#bdf2e6"
              transparent
              opacity={0.4}
              depthWrite={false}
              toneMapped={false}
              blending={AdditiveBlending}
              side={DoubleSide}
            />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              geometry={resources.wave}
              rotation={[0.3 * i, 0.2 * i, i * 2.1]}
              scale={0.65 + i * 0.15}
            >
              <meshBasicMaterial
                color={i === 1 ? '#d8b9ff' : '#e6faff'}
                transparent
                opacity={0.4}
                depthWrite={false}
                toneMapped={false}
                blending={AdditiveBlending}
                side={DoubleSide}
              />
            </mesh>
          ))}
          <mesh material={resources.glow}>
            <planeGeometry args={[1.9, 1.9]} />
          </mesh>
        </group>
        <group ref={beam} visible={false}>
          <mesh material={resources.white}>
            <cylinderGeometry args={[0.055, 0.15, 8, 8]} />
          </mesh>
          <mesh material={resources.softPurple}>
            <cylinderGeometry args={[0.35, 0.7, 8, 12, 1, true]} />
          </mesh>
          <mesh material={resources.softGold}>
            <cylinderGeometry args={[0.16, 0.36, 8, 10, 1, true]} />
          </mesh>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh
              key={i}
              position={[Math.sin(i * 2.4) * 0.48, (i - 3) * 0.8, Math.cos(i * 2.4) * 0.25]}
              rotation={[0, 0, Math.sin(i * 4) * 0.4]}
              material={resources.purple}
            >
              <cylinderGeometry args={[0.014, 0.035, 1.9, 4]} />
            </mesh>
          ))}
        </group>
        <group ref={blades} visible={false}>
          {Array.from({ length: 8 }, (_, i) => (
            <group key={i}>
              <mesh material={i % 2 ? resources.white : resources.gold}>
                <coneGeometry args={[0.095, 0.85, 4]} />
              </mesh>
              <mesh position={[0, -0.37, 0]} material={resources.purple}>
                <boxGeometry args={[0.3, 0.05, 0.05]} />
              </mesh>
            </group>
          ))}
        </group>
        <pointLight ref={light} intensity={0} distance={7} decay={2} />
      </group>
      <BurstParticles runtime={runtime} />
      <WeaponTrail runtime={runtime} />
      <StrikeAccents runtime={runtime} />
    </>
  );
}

/** Layered steel impacts and arcane shockwaves, reserved for the two smaller attacks. */
function StrikeAccents({ runtime }: { runtime: CombatRef }) {
  const compact = useThree((state) => state.size.width < 600);
  const root = useRef<Group>(null);
  const cuts = useRef<Group>(null);
  const impact = useRef<Group>(null);
  const casting = useRef<Group>(null);
  const wake = useRef<Group>(null);
  const resources = useMemo(
    () => ({
      edge: crescentGeometry(1, 0.065, Math.PI * 1.2),
      body: crescentGeometry(1, 0.27, Math.PI * 1.2),
      steel: ribbonMaterial('#fff3d0'),
      gold: ribbonMaterial('#ffc568'),
      blue: ribbonMaterial('#7ceaff'),
      white: energyMaterial('#fff8e2'),
      cyan: energyMaterial('#b6f7ff'),
      halo: new ShaderMaterial({
        uniforms: { tint: { value: new Color('#a8eeff') }, alpha: { value: 0 } },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(resources).forEach((value) => value.dispose()), [resources]);
  useFrame(() => {
    const { request, time } = runtime.current;
    if (!root.current) return;
    root.current.visible = !!request && request.kind !== 'ultimate';
    if (!request || request.kind === 'ultimate') return;
    const medium = request.kind === 'medium';
    const spec = ATTACKS[request.kind];
    const direction = directionFor(request.attacker);
    const origin = homeFor(request.attacker);
    const target = -origin;
    const y = elevationFor(compact) + heroScaleFor(compact) * 1.3;
    const after = time - spec.impact;
    const flash = impactEnvelope(time, spec.impact, medium ? 0.5 : 0.3);
    for (const material of [resources.steel, resources.gold, resources.blue])
      material.uniforms.time!.value = time;
    resources.white.opacity = flash * 0.95;
    resources.cyan.opacity = flash * 0.8;
    resources.cyan.color.set(medium ? '#b6f7ff' : '#ffd28b');
    resources.halo.uniforms.tint!.value.set(medium ? '#7beaff' : '#ffd18b');
    resources.halo.uniforms.alpha!.value = flash * (medium ? 1.2 : 0.8);

    if (cuts.current) {
      const group = cuts.current;
      group.visible = !medium && time > spec.impact - 0.23 && after < 0.43;
      group.position.set(target - direction * 0.3, y + 0.08, 0.95);
      group.rotation.set(-0.28, direction === 1 ? 0 : Math.PI, 0);
      group.children.forEach((child, index) => {
        const age = time - (spec.impact - 0.23 + index * 0.13);
        const progress = clamp01(age / 0.36);
        child.visible = age > 0 && progress < 1;
        child.rotation.z = (index ? 0.9 : -0.9) + (index ? -1 : 1) * easeOut(progress) * 0.85;
        child.scale.set(1.05 + easeOut(progress) * 0.38, 0.58 + index * 0.18, 1);
      });
      resources.steel.uniforms.alpha!.value =
        Math.sin(clamp01((time - spec.impact + 0.23) / 0.36) * Math.PI) * 1.5;
      resources.gold.uniforms.alpha!.value =
        Math.sin(clamp01((time - spec.impact + 0.1) / 0.36) * Math.PI) * 1.05;
    }
    if (impact.current) {
      const group = impact.current;
      group.visible = after >= 0 && after < (medium ? 0.75 : 0.45);
      group.position.set(target - direction * 0.16, y + 0.12, 1.15);
      const expansion = easeOut(after / (medium ? 0.45 : 0.28));
      group.rotation.set(-0.22, 0, medium ? 0.2 : -0.38);
      group.scale.setScalar((medium ? 1.25 : 0.75) * (0.4 + expansion * 0.85));
      group.children.forEach((child, index) => {
        if (index < 10) {
          const angle = (index * Math.PI) / 5;
          const radius = 0.18 + expansion * 0.45;
          child.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
          child.rotation.z = angle - Math.PI / 2;
          child.scale.set(
            index % 2 ? 0.55 : 1,
            (1 - clamp01(after / 0.5)) * (index % 2 ? 0.65 : 1.1),
            1,
          );
        } else if (index === 10) child.scale.setScalar(0.5 + expansion * 2);
        else if (child instanceof Mesh) {
          child.visible = medium;
          child.scale.setScalar(0.35 + expansion * (index === 11 ? 1.9 : 1.35));
          (child.material as MeshBasicMaterial).opacity =
            Math.max(0, 1 - after / 0.65) * (index === 11 ? 0.65 : 0.25);
        }
      });
    }
    if (casting.current) {
      const group = casting.current;
      group.visible = medium && time < spec.release + 0.16;
      group.position.set(origin + direction * 0.25, y + 0.15, 0.7);
      const strength = smooth(time / 0.45) * (1 - smooth((time - spec.release) / 0.16));
      group.scale.setScalar(0.25 + strength * 0.65);
      group.rotation.set(-0.3, 0, direction * time * 2.5);
      group.children.forEach((child, index) => {
        if (child instanceof Mesh)
          (child.material as MeshBasicMaterial).opacity = strength * (index === 0 ? 0.65 : 0.9);
      });
    }
    if (wake.current) {
      const group = wake.current;
      group.visible = medium && time >= spec.release && after < 0.05;
      const travel = clamp01((time - spec.release) / (spec.impact - spec.release));
      group.position.set(
        origin + (target - origin) * Math.pow(travel, 1.35),
        y + 0.1 + Math.sin(travel * Math.PI) * 0.3,
        0.85,
      );
      group.rotation.set(-0.3, direction === 1 ? 0 : Math.PI, 0);
      resources.blue.uniforms.alpha!.value = 0.6 * Math.sin(travel * Math.PI);
      group.children.forEach((child, index) => {
        const angle = index * 2.4 + time * 9;
        child.position.set(-0.2 - index * 0.14, Math.sin(angle) * 0.25, Math.cos(angle) * 0.17);
        child.rotation.z = -0.4 + Math.sin(angle) * 0.25;
        child.scale.set(1 + index * 0.05, 0.6 - index * 0.045, 1);
      });
    }
  });
  return (
    <group ref={root} visible={false}>
      <group ref={cuts} visible={false}>
        <mesh geometry={resources.edge} material={resources.steel} />
        <mesh geometry={resources.body} material={resources.gold} position={[0, 0, -0.025]} />
      </group>
      <group ref={impact} visible={false}>
        {Array.from({ length: 10 }, (_, index) => (
          <mesh key={index} material={index % 2 ? resources.cyan : resources.white}>
            <planeGeometry args={[index % 2 ? 0.025 : 0.045, 0.75]} />
          </mesh>
        ))}
        <mesh material={resources.halo}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        {[0, 1].map((index) => (
          <mesh key={index} rotation={[index ? 0.5 : 0, index ? 0.7 : 0, 0]}>
            <ringGeometry args={[0.92, index ? 0.97 : 1.015, 72]} />
            <meshBasicMaterial
              color={index ? '#5db7e7' : '#c6ffff'}
              transparent
              depthWrite={false}
              blending={AdditiveBlending}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <group ref={casting} visible={false}>
        <mesh>
          <ringGeometry args={[0.63, 0.65, 72]} />
          <meshBasicMaterial
            color="#74e6ff"
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
        {Array.from({ length: 8 }, (_, index) => (
          <mesh
            key={index}
            position={[
              Math.cos((index * Math.PI) / 4) * 0.52,
              Math.sin((index * Math.PI) / 4) * 0.52,
              0.01,
            ]}
            rotation={[0, 0, (index * Math.PI) / 4]}
          >
            <planeGeometry args={[0.12, 0.025]} />
            <meshBasicMaterial
              color="#c7faff"
              transparent
              depthWrite={false}
              blending={AdditiveBlending}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
      <group ref={wake} visible={false}>
        {Array.from({ length: 5 }, (_, index) => (
          <mesh key={index} geometry={resources.edge} material={resources.blue} />
        ))}
      </group>
    </group>
  );
}

/** Sample the skinned weapon in world space, so the slash belongs to the swing. */
function WeaponTrail({ runtime }: { runtime: CombatRef }) {
  const mesh = useRef<Mesh>(null);
  const history = useRef<{ tip: number[]; base: number[]; time: number }[]>([]);
  const last = useRef({ id: 0, time: -1 });
  const resources = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(8 * 2 * 3), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(8 * 2 * 2), 2));
    const indices: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
    }
    geometry.setIndex(indices);
    return { geometry, material: ribbonMaterial('#ffdda0') };
  }, []);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.material.dispose();
    },
    [resources],
  );
  useFrame(() => {
    if (!mesh.current) return;
    const { request, time, weapons } = runtime.current;
    if (!request) {
      mesh.current.visible = false;
      history.current = [];
      return;
    }
    if (last.current.id !== request.id) {
      history.current = [];
      last.current = { id: request.id, time: -1 };
    }
    const sample = weapons[request.attacker];
    const active =
      request.kind === 'basic'
        ? time > 0.5 && time < 1.06
        : request.kind === 'medium'
          ? time > 0.3 && time < 0.95
          : time > 1.5 && time < 2.7;
    if (sample && active && time !== last.current.time) {
      history.current.unshift({ tip: [...sample.tip], base: [...sample.base], time });
      last.current.time = time;
    }
    history.current = history.current.filter((p) => time - p.time < 0.17).slice(0, 8);
    const count = history.current.length;
    mesh.current.visible = count > 1;
    if (count < 2) return;
    const positions = resources.geometry.getAttribute('position');
    const uvs = resources.geometry.getAttribute('uv');
    for (let i = 0; i < count; i++) {
      const point = history.current[i]!;
      positions.setXYZ(i * 2, point.base[0]!, point.base[1]!, point.base[2]!);
      positions.setXYZ(i * 2 + 1, point.tip[0]!, point.tip[1]!, point.tip[2]!);
      uvs.setXY(i * 2, i / (count - 1), 0);
      uvs.setXY(i * 2 + 1, i / (count - 1), 1);
    }
    positions.needsUpdate = true;
    uvs.needsUpdate = true;
    resources.geometry.setDrawRange(0, (count - 1) * 6);
    resources.material.uniforms.time!.value = time;
    resources.material.uniforms.alpha!.value = 0.85;
    resources.material.uniforms.tint!.value.set(
      request.kind === 'basic' ? '#ffe1a2' : request.kind === 'medium' ? '#93eaff' : '#dab4ff',
    );
  });
  return (
    <mesh
      ref={mesh}
      geometry={resources.geometry}
      material={resources.material}
      frustumCulled={false}
      visible={false}
    />
  );
}
