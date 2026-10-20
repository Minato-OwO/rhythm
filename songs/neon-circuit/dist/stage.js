/* Frozen Hours — procedural ice stage with user-supplied clock artwork. */
(() => {
  'use strict';
  if (!window.AFRAME) return;
  const T = AFRAME.THREE;
  const TAU = Math.PI * 2;
  const CONFIG = { seed: 74419, clockRadius: 2.55, clockPosition: [0, 4.55, -8], crystalCount: 300, reflectionSize: 1024 };
  window.FROZEN_CONFIG = CONFIG;
  function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function canvasTexture(width, height, paint) {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    paint(c.getContext('2d'), width, height);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; return tex;
  }
  function glowTexture() {
    return canvasTexture(128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(200,255,255,1)'); g.addColorStop(.1, 'rgba(100,235,255,.8)');
      g.addColorStop(.35, 'rgba(40,160,255,.2)'); g.addColorStop(1, 'rgba(0,80,200,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
  }
  function environment() {
    const tex = canvasTexture(1024, 512, (c,w,h) => {
      const g = c.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#c6eaff');g.addColorStop(.25,'#316c94');g.addColorStop(.48,'#031020');g.addColorStop(.52,'#153957');g.addColorStop(1,'#247aaa');
      c.fillStyle = g;c.fillRect(0,0,w,h);
      [[80,60,110,240],[500,30,250,80],[850,150,110,180]].forEach(([x,y,ww,hh])=>{
        const light=c.createRadialGradient(x+ww/2,y+hh/2,5,x+ww/2,y+hh/2,ww);
        light.addColorStop(0,'rgba(220,249,255,1)');light.addColorStop(.4,'rgba(180,229,255,.75)');light.addColorStop(1,'rgba(150,215,255,0)');
        c.fillStyle=light;c.fillRect(x-ww,y-hh,ww*3,hh*3);
      });
    });
    tex.mapping = T.EquirectangularReflectionMapping;
    return tex;
  }
  function crystalGeometry(rng) {
    const positions = [], colors = [], sides = 5;
    const base=[], shoulder=[];
    const leanX=(rng()-.5)*.55, leanZ=(rng()-.5)*.35;
    for(let i=0;i<sides;i++){
      const a=i/sides*TAU, radius=.8+rng()*.3;
      base.push(new T.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius));
      shoulder.push(new T.Vector3(Math.cos(a)*radius*.73+leanX*.5,.5+rng()*.25,Math.sin(a)*radius*.73+leanZ*.5));
    }
    const tip=new T.Vector3(leanX,.98+rng()*.18,leanZ);
    const palette=['#43b2df','#a3e4f7','#1b85bd','#52b6dd','#145f94'];
    function tri(a,b,c,color){positions.push(...a.toArray(),...b.toArray(),...c.toArray());for(let i=0;i<3;i++)colors.push(color.r,color.g,color.b);}
    for(let i=0;i<sides;i++){
      const n=(i+1)%sides, col=new T.Color(palette[i]);col.multiplyScalar(.75+rng()*.5);
      tri(base[i],shoulder[i],base[n],col);tri(base[n],shoulder[i],shoulder[n],col.clone().multiplyScalar(.92));
      tri(shoulder[i],tip,shoulder[n],col.clone().multiplyScalar(1.12));
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  }
  // Original ChronomiaWatchFace images; no tracing, masking, or image repair.
  function clockArtwork() {
    const textures={}, pending=[];
    for(const name of ['bg','hour','minute','diamond']) {
      const image=new Image(), texture=new T.Texture(image);
      texture.colorSpace=T.SRGBColorSpace;
      pending.push(new Promise((resolve,reject)=>{
        image.onload=()=>{texture.needsUpdate=true;resolve();};
        image.onerror=()=>reject(new Error('時計の画像を読み込めません: '+name));
      }));
      image.src=window.FROZEN_CLOCK_ART[name];
      textures[name]=texture;
    }
    return {textures,ready:Promise.all(pending)};
  }
  // Placement values are copied from res/raw/watchface.xml (450 x 450).
  const CLOCK_LAYOUT={
    hour:{x:175,y:48,width:96,height:203,pivotX:.5,pivotY:.866995074},
    minute:{x:190,y:8,width:69,height:242,pivotX:.5,pivotY:.888429752},
    diamond:{x:170,y:170,width:110,height:110}
  };
  const CLOCK_MOTION={minuteStart:.365,hourStart:-2.65,minutePeriod:120,hourPeriod:1440};
  // The ice reflects the actual scene through a mirrored camera, not a background image.
  function reflectiveFloor(scene, renderer, size){
    const rt=new T.WebGLRenderTarget(size,size,{type:T.HalfFloatType});
    const mirrorCamera=new T.PerspectiveCamera();const textureMatrix=new T.Matrix4();
    const bias=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
    const material=new T.ShaderMaterial({uniforms:{reflection:{value:rt.texture},textureMatrix:{value:textureMatrix}},
      vertexShader:`uniform mat4 textureMatrix; varying vec4 vReflect; varying vec3 vWorld; void main(){vec4 w=modelMatrix*vec4(position,1.); vWorld=w.xyz; vReflect=textureMatrix*w; gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`uniform sampler2D reflection; varying vec4 vReflect; varying vec3 vWorld;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){vec2 uv=vReflect.xy/vReflect.w; float n=hash(floor(vWorld.xz*1.5)); uv+=vec2(sin(vWorld.x*3.7+vWorld.z*5.1),cos(vWorld.z*2.7-vWorld.x*2.))*0.00065; vec3 reflected=texture2D(reflection,uv).rgb;
        float fresnel=pow(1.-clamp(dot(normalize(cameraPosition-vWorld),vec3(0.,1.,0.)),0.,1.),3.); vec3 ice=vec3(.014,.065,.112)*(0.8+n*.45); vec3 color=mix(ice,reflected,.33+fresnel*.43); float fade=exp(-length(vWorld.xz)*.012);gl_FragColor=vec4(color*fade,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    const mesh=new T.Mesh(new T.PlaneGeometry(180,180),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=-.045;mesh.renderOrder=-2;
    const worldPos=new T.Vector3(), direction=new T.Vector3(), target=new T.Vector3(), viewport=new T.Vector4();let rendering=false;
    const clip=[new T.Plane(new T.Vector3(0,1,0),-.005)];
    mesh.onBeforeRender=(r,s,camera)=>{
      if(rendering || camera.isArrayCamera)return;rendering=true;
      camera.getWorldPosition(worldPos);camera.getWorldDirection(direction);target.copy(worldPos).add(direction);
      worldPos.y=-worldPos.y;target.y=-target.y;mirrorCamera.position.copy(worldPos);mirrorCamera.up.set(0,-1,0);mirrorCamera.lookAt(target);
      mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);mirrorCamera.updateMatrixWorld();
      textureMatrix.copy(bias).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
      const oldTarget=r.getRenderTarget(), oldClip=r.clippingPlanes, oldXr=r.xr.enabled, oldAuto=r.shadowMap.autoUpdate;r.getViewport(viewport);
      mesh.visible=false;r.xr.enabled=false;r.shadowMap.autoUpdate=false;r.clippingPlanes=clip;r.setRenderTarget(rt);r.clear();r.render(s,mirrorCamera);
      r.setRenderTarget(oldTarget);r.setViewport(viewport);r.clippingPlanes=oldClip;r.xr.enabled=oldXr;r.shadowMap.autoUpdate=oldAuto;mesh.visible=true;rendering=false;
    };
    return {mesh,dispose(){rt.dispose();material.dispose();mesh.geometry.dispose();}};
  }
  const stageDefinition={
    init(){
      this.elapsed=0;this.paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;this.ready=false;
      this.start=this.build.bind(this);
      if(this.el.renderer)this.build();else this.el.addEventListener('render-target-loaded',this.start,{once:true});
    },
    build(){
      if(this.ready)return;
      const scene=this.embedded?this.hostRoot:this.el.object3D, renderer=this.el.renderer; if(!renderer)return;
      this.group=new T.Group();this.group.name='Frozen Hours';scene.add(this.group);const rng=random(CONFIG.seed);
      if(!this.embedded){renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.6));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;}
      const env=environment(), pmrem=new T.PMREMGenerator(renderer);
      try{this.envTarget=pmrem.fromEquirectangular(env);}finally{env.dispose();pmrem.dispose();}
      if(!this.embedded){this.previousEnvironment=scene.environment;scene.environment=this.envTarget.texture;}
      const ambient=new T.HemisphereLight('#a6dfff','#052b55',1.25);this.group.add(ambient);
      const key=new T.DirectionalLight('#c4efff',3.3);key.position.set(-10,15,8);this.group.add(key);
      const rim=new T.DirectionalLight('#3185ed',2.8);rim.position.set(12,9,-16);this.group.add(rim);
      const fill=new T.PointLight('#74dcff',45,38,1.2);fill.position.set(-10,5,-9);this.group.add(fill);
      if(this.embedded){
        // ゲーム内では共有レンダラーの再帰描画を避け、環境反射の氷床を使う。
        const material=new T.MeshPhysicalMaterial({color:'#164466',metalness:.65,roughness:.14,clearcoat:1,envMap:this.envTarget.texture,envMapIntensity:.85});
        const mesh=new T.Mesh(new T.PlaneGeometry(180,180),material);mesh.rotation.x=-Math.PI/2;mesh.position.y=-.045;
        this.floor={mesh,dispose(){material.dispose();mesh.geometry.dispose();}};
      }else this.floor=reflectiveFloor(scene,renderer,window.innerWidth<700?512:CONFIG.reflectionSize);
      this.group.add(this.floor.mesh);
      this.buildCrystals(rng);this.buildIce(rng);this.buildClock();this.buildAtmosphere(rng);
      if(this.embedded){
        this.mergeCrystals();
        this.group.traverse(object=>{
          if(!object.material)return;
          for(const material of Array.isArray(object.material)?object.material:[object.material]){
            if(material.isMeshStandardMaterial)material.envMap=this.envTarget.texture;
            material.fog=false;
          }
        });
      }
      this.ready=true;this.setTime(0);
      if(!this.embedded)this.el.emit('stage-ready');
    },
    mergeCrystals(){
      const meshes=this.crystals.children.filter(mesh=>mesh.isMesh);
      const count=meshes.reduce((sum,mesh)=>sum+mesh.geometry.attributes.position.count,0);
      const positions=new Float32Array(count*3),normals=new Float32Array(count*3),colors=new Float32Array(count*3);
      let offset=0;
      for(const mesh of meshes){
        mesh.updateMatrix();
        const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrix);
        positions.set(geometry.attributes.position.array,offset);
        normals.set(geometry.attributes.normal.array,offset);
        colors.set(geometry.attributes.color.array,offset);
        offset+=geometry.attributes.position.array.length;
        geometry.dispose();mesh.geometry.dispose();
      }
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.BufferAttribute(positions,3));
      geometry.setAttribute('normal',new T.BufferAttribute(normals,3));
      geometry.setAttribute('color',new T.BufferAttribute(colors,3));
      geometry.computeBoundingSphere();
      this.crystals.clear();this.crystals.add(new T.Mesh(geometry,meshes[0].material));
    },
    buildCrystals(rng){
      const mat=new T.MeshPhysicalMaterial({vertexColors:true,metalness:.24,roughness:.16,clearcoat:1,clearcoatRoughness:.12,envMapIntensity:1.35,flatShading:true,side:T.DoubleSide});
      this.crystals=new T.Group();this.crystals.name='Crystal amphitheatre';
      // Closely spaced, staggered rows fill the backdrop and side walls.
      const backCount=Math.round(CONFIG.crystalCount*.56);
      const sideCount=Math.round(CONFIG.crystalCount*.24);
      const backColumns=Math.ceil(backCount/4);
      const sideColumns=Math.ceil(sideCount/6);
      const frontColumns=Math.ceil((CONFIG.crystalCount-backCount-sideCount)/3);
      for(let i=0;i<CONFIG.crystalCount;i++){
        let x,z,h,w;
        if(i<backCount){
          const row=Math.floor(i/backColumns),column=i%backColumns;
          const spacing=60/backColumns;
          x=(column-(backColumns-1)/2+(row%2)*.5)*spacing+(rng()-.5)*.65;
          z=-16-row*3.1-rng()*.9;
          h=4+rng()*7.5;w=1+rng()*1.65;
        }else if(i<backCount+sideCount){
          const j=i-backCount,side=j%2?1:-1,k=Math.floor(j/2);
          const row=Math.floor(k/sideColumns),column=k%sideColumns;
          x=side*(10.2+row*5.5+rng()*2);
          z=-15+column*1.75+(rng()-.5)*.9;
          h=2.4+rng()*6;w=.95+rng()*1.6;
        }else{
          const j=i-backCount-sideCount,row=Math.floor(j/frontColumns),column=j%frontColumns;
          const spacing=48/frontColumns;
          x=(column-(frontColumns-1)/2+(row%2)*.5)*spacing+(rng()-.5)*.7;
          z=-12-row*2.7-rng()*.7;
          h=1.4+rng()*3.4;w=.9+rng()*1.2;
          if(Math.abs(x)<3.8)h*=.55;
        }
        const mesh=new T.Mesh(crystalGeometry(rng),mat);mesh.position.set(x,-.04,z);mesh.scale.set(w,h,w*(.65+rng()*.65));mesh.rotation.set((rng()-.5)*.3,rng()*TAU,(rng()-.5)*.36);this.crystals.add(mesh);
      }
      [[-13,10,-19,2.0,-.18],[-7,7.4,-18,1.5,.25],[11,13,-23,2.3,.25],[18,8,-17,1.8,-.24],[-22,8,-14,1.8,.16]].forEach(([x,h,z,w,tilt])=>{const m=new T.Mesh(crystalGeometry(rng),mat);m.position.set(x,0,z);m.scale.set(w,h,w*.65);m.rotation.set(.05,.6,tilt);this.crystals.add(m);});
      this.group.add(this.crystals);
    },
    buildIce(rng){
      const pos=[],col=[];const nx=36,nz=38,step=1.65,grid=[];
      for(let z=0;z<=nz;z++){grid[z]=[];for(let x=0;x<=nx;x++)grid[z][x]=new T.Vector3((x-nx/2)*step+(rng()-.5)*1.1,.012+rng()*.065,15-z*step+(rng()-.5)*1.1);}
      const palette=['#4383a7','#28628e','#60a5c2','#245377','#88bfd2','#366f98'];
      function tri(a,b,c){if(rng()<.14)return;const center=a.clone().add(b).add(c).multiplyScalar(1/3);const shrink=.82+rng()*.16;const color=new T.Color(palette[Math.floor(rng()*palette.length)]);[a,b,c].forEach(v=>{const p=v.clone().sub(center).multiplyScalar(shrink).add(center);pos.push(p.x,p.y,p.z);col.push(color.r,color.g,color.b);});}
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=grid[z][x],b=grid[z+1][x],c=grid[z][x+1],d=grid[z+1][x+1];if(rng()<.5){tri(a,b,c);tri(c,b,d);}else{tri(a,b,d);tri(a,d,c);}}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('color',new T.Float32BufferAttribute(col,3));geo.computeVertexNormals();
      const mat=new T.MeshPhysicalMaterial({vertexColors:true,metalness:.48,roughness:.17,clearcoat:1,envMapIntensity:.85,transparent:true,opacity:.48,depthWrite:false,side:T.DoubleSide,flatShading:true});
      const ice=new T.Mesh(geo,mat);ice.name='Fractured ice sheets';ice.renderOrder=1;this.group.add(ice);
      const shardMat=new T.MeshPhysicalMaterial({color:'#86cfe5',metalness:.3,roughness:.16,clearcoat:1,envMapIntensity:1.1,flatShading:true});
      const shards=new T.InstancedMesh(new T.OctahedronGeometry(1,0),shardMat,185);const obj=new T.Object3D();
      for(let i=0;i<185;i++){const x=(rng()-.5)*47,z=11-rng()*49;obj.position.set(x,.03+rng()*.09,z);obj.scale.set(.25+rng()*1.0,.05+rng()*.14,.3+rng()*1.2);obj.rotation.set((rng()-.5)*.15,rng()*TAU,(rng()-.5)*.15);obj.updateMatrix();shards.setMatrixAt(i,obj.matrix);}shards.instanceMatrix.needsUpdate=true;this.group.add(shards);
    },
    buildClock(){
      this.clock=new T.Group();this.clock.name='Floating astronomical clock';this.clock.position.fromArray(CONFIG.clockPosition);this.group.add(this.clock);
      const radius=CONFIG.clockRadius, resources=clockArtwork(), artwork=resources.textures, unit=radius*2/450;
      this.artworkReady=resources.ready;
      if(!this.embedded)this.artworkReady.catch(error=>console.error(error.message));
      const caseMaterial=new T.MeshStandardMaterial({color:'#484b49',metalness:.55,roughness:.3});
      const caseMesh=new T.Mesh(new T.CylinderGeometry(radius*.98,radius*.98,.13,160,1,true),caseMaterial);
      caseMesh.rotation.x=Math.PI/2;caseMesh.position.z=-.005;this.clock.add(caseMesh);
      const back=new T.Mesh(new T.CircleGeometry(radius*.98,160),caseMaterial);back.rotation.y=Math.PI;back.position.z=-.075;this.clock.add(back);
      const material=texture=>new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.02,side:T.DoubleSide,toneMapped:false,fog:false});
      const face=new T.Mesh(new T.PlaneGeometry(radius*2,radius*2),material(artwork.bg));
      face.position.z=.07;face.name='Original Chronomia dial';this.clock.add(face);
      const hand=(name,z)=>{
        const p=CLOCK_LAYOUT[name], group=new T.Group();group.name='Original Chronomia '+name+' hand';
        group.position.set((p.x+p.width*p.pivotX-225)*unit,(225-p.y-p.height*p.pivotY)*unit,z);
        const mesh=new T.Mesh(new T.PlaneGeometry(p.width*unit,p.height*unit),material(artwork[name]));
        mesh.position.set(p.width*(.5-p.pivotX)*unit,p.height*(p.pivotY-.5)*unit,0);
        group.add(mesh);this.clock.add(group);return group;
      };
      this.hour=hand('hour',.095);this.minute=hand('minute',.12);
      this.hour.rotation.z=CLOCK_MOTION.hourStart;this.minute.rotation.z=CLOCK_MOTION.minuteStart;
      const p=CLOCK_LAYOUT.diamond;
      const hub=new T.Mesh(new T.PlaneGeometry(p.width*unit,p.height*unit),material(artwork.diamond));
      hub.position.set((p.x+p.width/2-225)*unit,(225-p.y-p.height/2)*unit,.15);hub.name='Original Chronomia diamond';this.clock.add(hub);
      this.crystal=new T.Mesh(new T.OctahedronGeometry(.28,0),new T.MeshStandardMaterial({color:'#c0ffff',emissive:'#32dcff',emissiveIntensity:3,metalness:.15,roughness:.1}));this.crystal.scale.set(.85,1.65,.85);this.crystal.position.set(0,.95,-8);this.group.add(this.crystal);
      this.glowMap=glowTexture();this.glow=new T.Sprite(new T.SpriteMaterial({map:this.glowMap,color:'#65eaff',transparent:true,blending:T.AdditiveBlending,depthWrite:false,opacity:.7}));this.glow.position.copy(this.crystal.position);this.glow.scale.set(2.0,2.4,1);this.group.add(this.glow);
      this.coreLight=new T.PointLight('#47dcff',8,8,1.6);this.coreLight.position.set(0,1.1,-8);this.group.add(this.coreLight);
    },
    buildAtmosphere(rng){
      const n=340,positions=new Float32Array(n*3);this.particleBase=[];
      for(let i=0;i<n;i++){const x=(rng()-.5)*66,y=.4+rng()*17,z=10-rng()*58;positions.set([x,y,z],i*3);this.particleBase.push({x,y,z,speed:.04+rng()*.1,phase:rng()*TAU});}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));
      this.particles=new T.Points(g,new T.PointsMaterial({map:this.glowMap,color:'#99d6ed',size:.075,transparent:true,opacity:.6,depthWrite:false,blending:T.AdditiveBlending,sizeAttenuation:true}));this.group.add(this.particles);
    },
    tick(time,delta){
      if(!this.ready||this.paused)return;
      this.elapsed+=Math.min(delta||0,80)/1000;this.setTime(this.elapsed);
    },
    setTime(time){
      if(!this.ready)return;const t=Math.max(0,time);
      this.clock.position.y=CONFIG.clockPosition[1]+Math.sin(t*.45)*.085;this.clock.rotation.y=Math.sin(t*.12)*.045;
      // Clockwise, with a 12:1 minute/hour ratio; first pose matches the supplied image.
      this.minute.rotation.z=CLOCK_MOTION.minuteStart-t*TAU/CLOCK_MOTION.minutePeriod;
      this.hour.rotation.z=CLOCK_MOTION.hourStart-t*TAU/CLOCK_MOTION.hourPeriod;
      this.crystal.position.y=.95+Math.sin(t*1.3)*.1;this.crystal.rotation.y=t*.48;this.glow.position.y=this.crystal.position.y;this.glow.material.opacity=.55+Math.sin(t*1.4)*.1;this.coreLight.intensity=8+Math.sin(t*1.4)*1.5;
      const a=this.particles.geometry.attributes.position;this.particleBase.forEach((p,i)=>{a.setXYZ(i,p.x+Math.sin(t*.14+p.phase)*.3,.4+(p.y-.4+t*p.speed)%17,p.z+Math.cos(t*.12+p.phase)*.22);});a.needsUpdate=true;
    },
    remove(){
      if(this.start)this.el.removeEventListener('render-target-loaded',this.start);
      if(!this.group||this.disposed)return;this.disposed=true;
      this.floor?.mesh.removeFromParent();this.floor?.dispose();
      if(!this.embedded&&this.el.object3D.environment===this.envTarget?.texture)this.el.object3D.environment=this.previousEnvironment;
      this.envTarget?.dispose();
      const geometries=new Set(),materials=new Set(),textures=new Set();this.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
      materials.forEach(m=>{if(m.map)textures.add(m.map);m.dispose();});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());this.group.removeFromParent();
    }
  };
  window.FROZEN_HOURS={
    async createBackground({scene}){
      const stage=Object.create(stageDefinition);
      Object.assign(stage,{el:scene,hostRoot:new T.Group(),embedded:true,ready:false,elapsed:0});
      try{
        stage.build();
        if(!stage.ready)throw new Error('背景シーンのレンダラーが準備できていません。');
        await stage.artworkReady;
        return {object3D:stage.group,update(time){stage.setTime(time);},dispose(){stage.remove();}};
      }catch(error){stage.remove();throw error;}
    }
  };
  if(!AFRAME.components['frozen-stage'])AFRAME.registerComponent('frozen-stage',stageDefinition);
  if(!AFRAME.components['stage-camera'])AFRAME.registerComponent('stage-camera',{
    init(){
      this.target=new T.Vector3(0,3.7,-8);this.yaw=0;this.pitch=.00435;this.distance=23;this.goal={yaw:0,pitch:.00435,distance:23};this.dragging=false;
      this.bind=this.attach.bind(this);if(this.el.sceneEl.canvas)this.attach();else this.el.sceneEl.addEventListener('render-target-loaded',this.bind,{once:true});
    },
    attach(){
      const canvas=this.el.sceneEl.canvas;if(!canvas||this.controller)return;this.controller=new AbortController();const signal=this.controller.signal;
      canvas.tabIndex=0;canvas.setAttribute('aria-label','3Dステージ。ドラッグまたは矢印キーで視点を変更、スクロールでズーム、Rキーで視点を戻す。');
      canvas.addEventListener('pointerdown',e=>{this.dragging=true;this.lastX=e.clientX;this.lastY=e.clientY;canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';},{signal});
      canvas.addEventListener('pointermove',e=>{if(!this.dragging)return;this.goal.yaw-=(e.clientX-this.lastX)*.003;this.goal.pitch+=(e.clientY-this.lastY)*.002;this.limit();this.lastX=e.clientX;this.lastY=e.clientY;},{signal});
      const end=()=>{this.dragging=false;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',end,{signal});canvas.addEventListener('pointercancel',end,{signal});canvas.style.cursor='grab';
      canvas.addEventListener('wheel',e=>{e.preventDefault();this.goal.distance+=e.deltaY*.012;this.limit();},{passive:false,signal});
      canvas.addEventListener('keydown',e=>{let used=true;switch(e.key){case 'ArrowLeft':this.goal.yaw+=.07;break;case 'ArrowRight':this.goal.yaw-=.07;break;case 'ArrowUp':this.goal.pitch+=.035;break;case 'ArrowDown':this.goal.pitch-=.035;break;case '+':case '=':this.goal.distance-=1;break;case '-':this.goal.distance+=1;break;case 'r':case 'R':this.reset();break;default:used=false;}if(used){e.preventDefault();this.limit();}},{signal});
    },
    limit(){this.goal.yaw=T.MathUtils.clamp(this.goal.yaw,-.85,.85);this.goal.pitch=T.MathUtils.clamp(this.goal.pitch,-.065,.42);this.goal.distance=T.MathUtils.clamp(this.goal.distance,14,34);},
    reset(){this.goal={yaw:0,pitch:.00435,distance:23};},
    tick(time,delta){
      const f=1-Math.exp(-Math.min(delta||16,80)/140);this.yaw=T.MathUtils.lerp(this.yaw,this.goal.yaw,f);this.pitch=T.MathUtils.lerp(this.pitch,this.goal.pitch,f);this.distance=T.MathUtils.lerp(this.distance,this.goal.distance,f);
      // Pull back on portrait screens so the complete clock stays in frame.
      const aspect=window.innerWidth/window.innerHeight;const d=this.distance*(aspect<.85?1.28:1);
      this.el.object3D.position.set(this.target.x+Math.sin(this.yaw)*d*Math.cos(this.pitch),this.target.y+Math.sin(this.pitch)*d,this.target.z+Math.cos(this.yaw)*d*Math.cos(this.pitch));this.el.object3D.rotation.set(-this.pitch,this.yaw,0,'YXZ');
    },
    remove(){this.controller?.abort();this.el.sceneEl.removeEventListener('render-target-loaded',this.bind);}
  });
})();


