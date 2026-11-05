'use client';

/* GPU volume resources and transforms are mutable renderer state. */
import { useEffect, useMemo, useRef } from 'react';
import './arena-clouds.css';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  BackSide,
  BoxGeometry,
  Data3DTexture,
  FileLoader,
  GLSL3,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  RGFormat,
  ShaderMaterial,
  Vector3,
  type OrthographicCamera,
} from 'three';

const VERTEX = `out vec3 localPosition;
void main(){localPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const FRAGMENT = `precision highp sampler3D;
in vec3 localPosition;
out vec4 cloudColor;
uniform sampler3D densityMap;
uniform vec3 rayDirection;
uniform float steps;
uniform float opacity;
uniform float age;
uniform float warmth;
vec2 boxIntersection(vec3 origin,vec3 direction){
  vec3 inverseDirection=1./direction;
  vec3 nearFace=(-.5-origin)*inverseDirection;
  vec3 farFace=(.5-origin)*inverseDirection;
  vec3 entry=min(nearFace,farFace),exit=max(nearFace,farFace);
  return vec2(max(entry.x,max(entry.y,entry.z)),min(exit.x,min(exit.y,exit.z)));
}
void main(){
  vec3 direction=normalize(rayDirection);
  vec3 origin=localPosition-direction*2.;
  vec2 intersection=boxIntersection(origin,direction);
  if(intersection.x>intersection.y)discard;
  float stepLength=(intersection.y-intersection.x)/steps;
  vec3 point=origin+direction*(intersection.x+stepLength*.45);
  vec3 increment=direction*stepLength;
  vec4 sum=vec4(0.);
  for(int i=0;i<48;i++){
    if(float(i)>=steps||sum.a>.988)break;
    vec3 coord=point+.5;
    // Slow deformation adds life without changing the overall silhouette.
    coord.x+=sin(coord.y*8.+age*.045)*.003;
    coord.z+=cos(coord.x*6.-age*.035)*.003;
    vec2 volume=texture(densityMap,coord).rg;
    float density=volume.r;
    if(density>.008){
      float light=pow(volume.g,1.1);
      vec3 shade=mix(vec3(.59,.71,.80),vec3(1.,.995,.965),light);
      shade+=vec3(.025,.012,-.006)*warmth*light;
      float alpha=1.-exp(-density*stepLength*22.);
      sum.rgb+=(1.-sum.a)*shade*alpha;
      sum.a+=(1.-sum.a)*alpha;
    }
    point+=increment;
  }
  if(sum.a<.008)discard;
  cloudColor=vec4(sum.rgb/max(sum.a,.001),sum.a*opacity);
}`;

// All paths wrap beyond the frustum. Their different depths/speeds create parallax.
const CLOUDS = [
  { x: -7.2, level: 0.18, depth: 23, size: [7.6, 3.8, 3.7], speed: 0.15, alpha: 0.96, seed: 0 },
  { x: 5.1, level: 0.31, depth: 18, size: [6.1, 3.5, 3.4], speed: 0.2, alpha: 0.95, seed: 1 },
  { x: -1.5, level: 0.07, depth: 32, size: [5.3, 2.8, 3.0], speed: 0.08, alpha: 0.76, seed: 1 },
  { x: -9.2, level: 0.61, depth: 29, size: [7.1, 3.2, 3.5], speed: -0.1, alpha: 0.81, seed: 1 },
  { x: 5.3, level: 0.82, depth: 26, size: [9.4, 3.8, 4.1], speed: -0.13, alpha: 0.88, seed: 0 },
  { x: 12, level: 0.52, depth: 36, size: [6.5, 3.0, 3.0], speed: 0.075, alpha: 0.73, seed: 0 },
] as const;

export function ArenaClouds({ playing }: { playing: boolean }) {
  const { camera, size } = useThree();
  const compact = size.width < 600;
  const buffers = useLoader(
    FileLoader,
    ['/arena/environment/clouds/cumulus-a.rg8?v=2', '/arena/environment/clouds/cumulus-b.rg8?v=2'],
    (loader) => loader.setResponseType('arraybuffer'),
  );
  const time = useRef(0);
  const resources = useMemo(() => {
    const textures = buffers.map((buffer) => {
      const texture = new Data3DTexture(new Uint8Array(buffer as ArrayBuffer), 128, 80, 80);
      texture.format = RGFormat;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      return texture;
    });
    const geometry = new BoxGeometry(1, 1, 1);
    const root = new Group();
    root.name = 'Living volumetric cumulus clouds';
    const clouds = CLOUDS.map((spec, index) => {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          densityMap: { value: textures[spec.seed] },
          rayDirection: { value: new Vector3(0, -0.3, -1) },
          steps: { value: 32 },
          opacity: { value: spec.alpha },
          age: { value: index * 11 },
          warmth: { value: 1 - index * 0.12 },
        },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.name = `cumulus-${index}`;
      mesh.scale.set(spec.size[0], spec.size[1], spec.size[2]);
      // Rotating around Y changes the real 3D silhouette rather than flipping a flat card.
      mesh.rotation.y = ((index % 3) - 1) * 0.16;
      root.add(mesh);
      return { mesh, material };
    });
    return { root, clouds, geometry, textures, inverse: new Matrix4(), direction: new Vector3() };
  }, [buffers]);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.textures.forEach((texture) => texture.dispose());
      resources.clouds.forEach((cloud) => cloud.material.dispose());
    },
    [resources],
  );
  useFrame((_, delta) => {
    if (playing && !document.hidden) time.current += Math.min(delta, 0.06);
    const zoom = (camera as OrthographicCamera).zoom;
    const height = size.height / zoom;
    camera.getWorldDirection(resources.direction);
    resources.clouds.forEach(({ mesh, material }, index) => {
      const spec = CLOUDS[index]!;
      const span = 34;
      const x =
        ((((spec.x + time.current * spec.speed * 2.5 + span / 2) % span) + span) % span) - span / 2;
      const screenY = height * (0.5 - spec.level);
      const y = (screenY + 0.5 * 0.95 - spec.depth * 0.31) / 0.95;
      mesh.position.set(x, y, -spec.depth);
      mesh.updateMatrixWorld();
      resources.inverse.copy(mesh.matrixWorld).invert();
      material.uniforms
        .rayDirection!.value.copy(resources.direction)
        .transformDirection(resources.inverse);
      material.uniforms.steps!.value = compact ? 22 : 32;
      material.uniforms.age!.value = time.current + index * 11;
    });
  });
  return <primitive object={resources.root} dispose={null} />;
}
