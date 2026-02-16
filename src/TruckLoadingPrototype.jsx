//RS 2/15

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

//box configs based on top 5 sizes from shipment- RS
//box sizes- RS
const BOX_CONFIGS = [
  { 
    id: 'box1', 
    dimensions: { width: 17.5/12, height: 5.75/12, depth: 13.0/12 }, //inches to feet
    color: '#FF6B35', 
    label: '17.5″ × 13″ × 5.75″'
  },
  { 
    id: 'box2', 
    dimensions: { width: 9.5/12, height: 48.0/12, depth: 4.5/12 }, 
    color: '#004E89', 
    label: '9.5″ × 4.5″ × 48″'
  },
  { 
    id: 'box3', 
    dimensions: { width: 30.25/12, height: 13.5/12, depth: 25.63/12 }, 
    color: '#1AA37A', 
    label: '30.25″ × 25.63″ × 13.5″'
  },
  { 
    id: 'box4', 
    dimensions: { width: 29.0/12, height: 5.5/12, depth: 26.0/12 }, 
    color: '#9B59B6', 
    label: '29″ × 26″ × 5.5″'
  },
  { 
    id: 'box5', 
    dimensions: { width: 12.75/12, height: 5.75/12, depth: 7.5/12 }, 
    color: '#E74C3C', 
    label: '12.75″ × 7.5″ × 5.75″'
  }
];

//standard 53' trailer dimensions- feet- RS
const TRUCK_DIMENSIONS = {
  length: 53,
  width: 8.5,
  height: 9
};

const TruckLoadingPrototype = () => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const [boxes, setBoxes] = useState([]);
  const [selectedBoxType, setSelectedBoxType] = useState(BOX_CONFIGS[0]);
  const [stats, setStats] = useState({ fps: 60, boxCount: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 30, y: window.innerHeight - 420 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!mountRef.current) return;

    //scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f5f5);
    sceneRef.current = scene;

    //camera set up- RS
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(20, 25, 40);
    cameraRef.current = camera;

    //renderer setup- RS
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    //orbit controls with constraints- RS
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(-20, TRUCK_DIMENSIONS.height / 2, 0); 
    controlsRef.current = controls;

    //lighting setup- RS
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(20, 30, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    scene.add(directionalLight);

    //truck/ container dim- 53' × 8.5' × 9'- RS
    const truckGroup = new THREE.Group();

    //floor setup - RS
    const floorGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      0.2,
      TRUCK_DIMENSIONS.width
    );
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B7355,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = 0.1;
    floor.receiveShadow = true;
    truckGroup.add(floor);

    //semi-transparent wall material- edit RS
    //2/15 change
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xC0C0C0,
      roughness: 0.7,
      metalness: 0.3,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    //RS Walls
    //left wall
    const sideWallGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      TRUCK_DIMENSIONS.height,
      0.2
    );
    const leftWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    leftWall.position.set(0, TRUCK_DIMENSIONS.height / 2, -TRUCK_DIMENSIONS.width / 2);
    leftWall.receiveShadow = true;
    truckGroup.add(leftWall);

    //right wall
    const rightWall = new THREE.Mesh(sideWallGeometry, wallMaterial);
    rightWall.position.set(0, TRUCK_DIMENSIONS.height / 2, TRUCK_DIMENSIONS.width / 2);
    rightWall.receiveShadow = true;
    truckGroup.add(rightWall);

    //ceiling
    const ceilingGeometry = new THREE.BoxGeometry(
      TRUCK_DIMENSIONS.length,
      0.2,
      TRUCK_DIMENSIONS.width
    );
    const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
    ceiling.position.y = TRUCK_DIMENSIONS.height - 0.1;
    ceiling.receiveShadow = true;
    truckGroup.add(ceiling);

     const edgesGeometry = new THREE.EdgesGeometry(floorGeometry);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const floorEdges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    floorEdges.position.copy(floor.position);
    truckGroup.add(floorEdges);

    scene.add(truckGroup);

    //bay1 loading/ box are - RS
    const bayGroup = new THREE.Group();
    
    //bay 1 floor- RS
    const bayFloorGeometry = new THREE.PlaneGeometry(20, 15);
    const bayFloorMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3
    });
    const bayFloor = new THREE.Mesh(bayFloorGeometry, bayFloorMaterial);
    bayFloor.rotation.x = -Math.PI / 2;
    bayFloor.position.set(-40, 0.01, 0); 
    bayFloor.receiveShadow = true;
    bayGroup.add(bayFloor);

    //bay 1 border - RS
    const bayBorderPoints = [
      new THREE.Vector3(-50, 0.02, -7.5),
      new THREE.Vector3(-30, 0.02, -7.5),
      new THREE.Vector3(-30, 0.02, 7.5),
      new THREE.Vector3(-50, 0.02, 7.5),
      new THREE.Vector3(-50, 0.02, -7.5)
    ];
    const bayBorderGeometry = new THREE.BufferGeometry().setFromPoints(bayBorderPoints);
    const bayBorderMaterial = new THREE.LineBasicMaterial({ 
      color: 0xF39C12, 
      linewidth: 3 
    });
    const bayBorder = new THREE.Line(bayBorderGeometry, bayBorderMaterial);
    bayGroup.add(bayBorder);

    //bay 1 sign- RS
    const labelPostGeometry = new THREE.BoxGeometry(0.6, 8, 0.6);
    const labelPostMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.5,
      metalness: 0.5
    });
    const labelPost = new THREE.Mesh(labelPostGeometry, labelPostMaterial);
    labelPost.position.set(-52, 4, -8);
    labelPost.castShadow = true;
    bayGroup.add(labelPost);

   //edit 2/15 bay 1 sign RS
    const signGeometry = new THREE.BoxGeometry(5, 2.5, 0.3);
    const signMaterial = new THREE.MeshStandardMaterial({
      color: 0xF39C12,
      roughness: 0.3,
      metalness: 0.1
    });
    const sign = new THREE.Mesh(signGeometry, signMaterial);
    sign.position.set(-52, 9.25, -8); // Raised to top of 8ft pole (4+4+1.25)
    sign.rotation.y = Math.PI / 2; // Rotate to face forward
    sign.castShadow = true;
    bayGroup.add(sign);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    
    context.fillStyle = '#F39C12';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#2C3E50';
    context.font = 'bold 120px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('BAY 1', canvas.width / 2, canvas.height / 2);
    

    const texture = new THREE.CanvasTexture(canvas);
    const textMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.2
    });
  
    const textGeometry = new THREE.BoxGeometry(4.8, 2.3, 0.1);
    const bayText = new THREE.Mesh(textGeometry, textMaterial);
    bayText.position.set(-51.85, 9.25, -8); 
    bayText.rotation.y = Math.PI / 2; 
    bayGroup.add(bayText);

    scene.add(bayGroup);

    //ground plane RS
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0xe0e0e0,
      roughness: 0.9
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

   
    const gridHelper = new THREE.GridHelper(100, 50, 0xcccccc, 0xdddddd);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    //fps counter...add?keep? RS
    let lastTime = performance.now();
    let frames = 0;

    
    const animate = () => {
      requestAnimationFrame(animate);
      
      controls.update();
      renderer.render(scene, camera);

      //FPS calculation- RS...add?keep?
      frames++;
      const currentTime = performance.now();
      if (currentTime >= lastTime + 1000) {
        setStats(prev => ({ ...prev, fps: Math.round(frames * 1000 / (currentTime - lastTime)) }));
        frames = 0;
        lastTime = currentTime;
      }
    };

    //window resize- RS
    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };

    window.addEventListener('resize', handleResize);
    animate();
    setTimeout(() => setIsLoading(false), 100);

    //cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  //add box - RS, final this works
  const addBox = () => {
    if (boxes.length >= 50) {
      alert('Maximum 50 boxes reached for performance');
      return;
    }

    const boxGeometry = new THREE.BoxGeometry(
      selectedBoxType.dimensions.width,
      selectedBoxType.dimensions.height,
      selectedBoxType.dimensions.depth
    );
    
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: selectedBoxType.color,
      roughness: 0.5,
      metalness: 0.1
    });
    
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    
    //spawn boxes in Bay 1- RS
    //this works 2/15
    const boxesPerRow = 4;
    const row = Math.floor(boxes.length / boxesPerRow);
    const col = boxes.length % boxesPerRow;
    
    //bay 1- x=-40, z=0 dime 20×15
    const bayStartX = -50; //left edge of bay
    const bayStartZ = -6;  //front edge of bay
    const spacingX = 4.5;
    const spacingZ = 3.5;
    
    box.position.set(
      bayStartX + col * spacingX + 2,
      selectedBoxType.dimensions.height / 2, 
      bayStartZ + row * spacingZ + 2
    );
    
    box.castShadow = true;
    box.receiveShadow = true;

    
    const edges = new THREE.EdgesGeometry(boxGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
    box.add(edgeLines);

    sceneRef.current.add(box);
    
    const newBox = {
      id: Date.now(),
      mesh: box,
      type: selectedBoxType.id
    };
    
    setBoxes(prev => [...prev, newBox]);
    setStats(prev => ({ ...prev, boxCount: prev.boxCount + 1 }));
  };

  const clearBoxes = () => {
    boxes.forEach(box => {
      sceneRef.current.remove(box.mesh);
      box.mesh.geometry.dispose();
      box.mesh.material.dispose();
    });
    setBoxes([]);
    setStats(prev => ({ ...prev, boxCount: 0 }));
  };

  
  const handleMouseDown = (e) => {
    if (e.target.closest('.panel-header')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - panelPosition.x,
        y: e.clientY - panelPosition.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPanelPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      margin: 0,
      padding: 0,
      overflow: 'hidden',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#ffffff'
    }}>
      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '20px 30px',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.98), rgba(255,255,255,0.92))',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.1)',
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: '24px',
            fontWeight: 700,
            color: '#1a1a1a',
            letterSpacing: '-0.5px'
          }}>
            Truck Loading Simulator
          </h1>
          <p style={{
            margin: '4px 0 0 0',
            fontSize: '13px',
            color: '#666',
            fontWeight: 400
          }}>
            53' × 8.5' × 9' Standard Trailer
          </p>
        </div>
        
        {/* Performance Stats */}
        <div style={{
          display: 'flex',
          gap: '20px',
          fontSize: '13px',
          color: '#666'
        }}>
          <div>
            <strong style={{ color: stats.fps >= 60 ? '#1AA37A' : '#FF6B35' }}>
              {stats.fps || 60} FPS
            </strong>
          </div>
          <div>
            Boxes: <strong>{stats.boxCount || 0}</strong>
          </div>
        </div>
      </div>

      {/* 3D Canvas */}
      <div 
        ref={mountRef} 
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0
        }}
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid #e0e0e0',
              borderTop: '3px solid #004E89',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }} />
            <p style={{ color: '#666', fontSize: '14px' }}>Loading 3D Environment...</p>
          </div>
        </div>
      )}

      {/* Control Panel - Draggable & Minimizable */}
      <div 
        style={{
          position: 'absolute',
          left: `${panelPosition.x}px`,
          top: `${panelPosition.y}px`,
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          minWidth: '320px',
          zIndex: 10,
          userSelect: 'none'
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Draggable Header */}
        <div 
          className="panel-header"
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            cursor: 'move',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <h3 style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 600,
            color: '#ffffff'
          }}>
            Add Boxes
          </h3>
          <button
            onClick={() => setIsPanelMinimized(!isPanelMinimized)}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '4px',
              color: '#ffffff',
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: '14px',
              fontWeight: 600
            }}
          >
            {isPanelMinimized ? '□' : '−'}
          </button>
        </div>

        {/* Panel Content (collapsible) */}
        {!isPanelMinimized && (
          <div style={{ padding: '24px' }}>
            {/* Box Type Selector */}
            <div style={{ marginBottom: '20px' }}>
              {BOX_CONFIGS.map(config => (
                <div
                  key={config.id}
                  onClick={() => setSelectedBoxType(config)}
                  style={{
                    padding: '12px 16px',
                    marginBottom: '8px',
                    border: `2px solid ${selectedBoxType.id === config.id ? config.color : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: selectedBoxType.id === config.id ? `${config.color}10` : '#ffffff',
                    transform: selectedBoxType.id === config.id ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      background: config.color,
                      borderRadius: '4px',
                      flexShrink: 0
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#1a1a1a'
                      }}>
                        {config.label}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <button
              onClick={addBox}
              disabled={boxes.length >= 50}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: selectedBoxType.color,
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: boxes.length >= 50 ? 'not-allowed' : 'pointer',
                opacity: boxes.length >= 50 ? 0.5 : 1,
                transition: 'all 0.2s ease',
                marginBottom: '8px'
              }}
              onMouseEnter={(e) => {
                if (boxes.length < 50) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              Add Box ({selectedBoxType.label.split(' ')[0]}″)
            </button>

            <button
              onClick={clearBoxes}
              disabled={boxes.length === 0}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: '#ffffff',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
                opacity: boxes.length === 0 ? 0.5 : 1,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (boxes.length > 0) {
                  e.target.style.borderColor = '#FF6B35';
                  e.target.style.color = '#FF6B35';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = '#e0e0e0';
                e.target.style.color = '#666';
              }}
            >
              Clear All Boxes
            </button>
          </div>
        )}
      </div>

      {/* Controls Guide */}
      <div style={{
        position: 'absolute',
        top: 100,
        right: 30,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        padding: '16px 20px',
        fontSize: '13px',
        color: '#666',
        maxWidth: '220px',
        zIndex: 10
      }}>
        <h4 style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          fontWeight: 600,
          color: '#1a1a1a'
        }}>
          Camera Controls
        </h4>
        <div style={{ lineHeight: '1.8' }}>
          <div><strong>Rotate:</strong> Left click + drag</div>
          <div><strong>Zoom:</strong> Scroll wheel</div>
          <div><strong>Pan:</strong> Right click + drag</div>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TruckLoadingPrototype;
//RS 2/15