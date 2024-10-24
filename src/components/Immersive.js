import { React, useState, useEffect, useMemo, useRef } from 'react';
import { OrbitControls, FlyControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';

import { SplatRenderer } from './ShapeRenderer';

const CameraUpdater = ({ axis, point }) => {
    const { camera, set } = useThree();

    useEffect(() => {
        const setCameraFromAxis = (axis, point) => {
            let position;
            if (axis === 'X') {
                position = [10, 0, 0];
            } else if (axis === 'Y') {
                position = [0, 10, 0];
            } else if (axis === 'Z') {
                position = [0, 0, 10];
            } else {
                position = [0, 0, 0];
            }
            camera.position.set(...position);
        };

        setCameraFromAxis(axis, point);
    }, [axis, point, camera]);

    return null;
};

const Immersive = () => {

    // step

    const [step, setStep] = useState(0);

    // Error

    const [error, setError] = useState(null);

    // Load splat file

    const [splatData, setSplatData] = useState(null);
    const [splatUrl, setSplatUrl] = useState(null);
    const [splatLoad, setSplatLoad] = useState(false);

    const handleSplatUrlLoad = () => {
        if (splatUrl) {
            setSplatLoad(prev => prev + 1); // Increment to trigger reload
        }
    };

    const handleSplatFileChange = async (e) => {
        const file = e.target.files[0];

        if (!file) {
            setSplatData(null);
            setError('No file selected');
            return;
        } else {
            console.log('File selected:', file);
            setSplatData(URL.createObjectURL(file));

            setError(null);
        }
    };

    // initialize calibration

    const scaleStep = 0.1;
    const rotateStep = 1;
    const translateStep = 0.1;
    const rangeStep = 0.1;

    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
    const [translation, setTranslation] = useState({ x: -1.3, y: 0, z: -1.3 });

    const calibration = useMemo(() => {
        return {
            scale: scale,
            rotation: [rotation.x / 180 * Math.PI, rotation.y / 180 * Math.PI, rotation.z / 180 * Math.PI],
            translation: [translation.x, translation.y, translation.z]
        };
    }, [scale, rotation, translation]);

    const [range, setRange] = useState({ x: [-20, 20], y: [-20, 20], z: [-20, 20] });

    return (
        <div
            style={{
                position: 'relative',
                height: '100vh',
                width: '100vw',
            }}
        >
            <div style={{
                position: 'absolute',
                top: '10%',
                right: '20px',
                width: '300px',
                height: '75vh',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                padding: '20px',
                borderRadius: '10px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'white',
                zIndex: 1000
            }}>
                <div
                    style={{
                        height: '100%',
                        width: '100%',
                        padding: '0 20px 0 0',
                        overflowX: 'hidden',
                        overflowY: 'auto',
                    }}
                >

                    <div>
                        <h2 style={{ marginBottom: '20px' }}>Editor</h2>

                        <button
                            onClick={() => setStep(0)}
                        >Step 0: Choose File</button>

                        <br />

                        <button
                            onClick={() => setStep(1)}
                        >Step 1: Calibration</button>
                    </div>

                    <div style={{
                        height: '5px',
                        width: '100%',
                        backgroundColor: 'darkgray',
                        margin: '20px 0'
                    }}></div>

                    {step === 0 && <div>
                        <div style={{ marginBottom: '20px' }}>
                            <h4 style={{ marginBottom: '10px' }}>Upload Splat Model</h4>
                            <input
                                type="file"
                                onChange={handleSplatFileChange}
                                accept=".splat"
                                style={{ padding: '8px', width: '100%' }}
                            />

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                }}
                            >
                                <input
                                    type="text"
                                    placeholder="URL"
                                    onChange={(e) => {
                                        setSplatUrl(e.target.value);
                                        setSplatLoad(false);
                                    }}
                                />
                                <br />
                                <button
                                    onClick={() => handleSplatUrlLoad(true)}
                                >Load</button>
                            </div>
                        </div>

                        {error && <p style={{ color: 'red' }}>{error}</p >}
                    </div>}

                    {step == 1 && <div>

                        <div style={{ marginTop: '20px' }}>
                            {/* Scale Control */}
                            <h4>Scale</h4>
                            <span>{scale}</span>
                            <input
                                type="range"
                                min="0.1"
                                max="10"
                                step={scaleStep}
                                value={scale}
                                onChange={(e) => setScale(e.target.value)}
                                style={{ width: '100%' }}
                            />

                            {/* Rotation Controls */}
                            <h4 style={{ marginTop: '20px' }}>Rotation (Degrees)</h4>
                            <label>X: </label>
                            <span>{rotation.x}°</span>
                            <input
                                type="range"
                                min="-180"
                                max="180"
                                step={rotateStep}
                                value={rotation.x}
                                onChange={(e) => setRotation({ ...rotation, x: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            <label>Y: </label>
                            <span>{rotation.y}°</span>
                            <input
                                type="range"
                                min="-180"
                                max="180"
                                step={rotateStep}
                                value={rotation.y}
                                onChange={(e) => setRotation({ ...rotation, y: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            <label>Z: </label>
                            <span>{rotation.z}°</span>
                            <input
                                type="range"
                                min="-180"
                                max="180"
                                step={rotateStep}
                                value={rotation.z}
                                onChange={(e) => setRotation({ ...rotation, z: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            {/* Translation Controls */}
                            <h4 style={{ marginTop: '20px' }}>Translation</h4>
                            <label>X: </label>
                            <span>{translation.x}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={translateStep}
                                value={translation.x}
                                onChange={(e) => setTranslation({ ...translation, x: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            <label>Y: </label>
                            <span>{translation.y}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={translateStep}
                                value={translation.y}
                                onChange={(e) => setTranslation({ ...translation, y: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            <label>Z: </label>
                            <span>{translation.z}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={translateStep}
                                value={translation.z}
                                onChange={(e) => setTranslation({ ...translation, z: e.target.value })}
                                style={{ width: '100%' }}
                            />

                            <h4 style={{ marginTop: '20px' }}>Range</h4>
                            <label>X: </label>
                            <span>{range.x[0]} - {range.x[1]}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.x[0]}
                                onChange={(e) => setRange({ ...range, x: [e.target.value, range.x[1]] })}
                                style={{ width: '100%' }}
                            />

                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.x[1]}
                                onChange={(e) => setRange({ ...range, x: [range.x[0], e.target.value] })}
                                style={{ width: '100%' }}
                            />

                            <label>Y: </label>
                            <span>{range.y[0]} - {range.y[1]}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.y[0]}
                                onChange={(e) => setRange({ ...range, y: [e.target.value, range.y[1]] })}
                                style={{ width: '100%' }}
                            />

                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.y[1]}
                                onChange={(e) => setRange({ ...range, y: [range.y[0], e.target.value] })}
                                style={{ width: '100%' }}
                            />

                            <label>Z: </label>
                            <span>{range.z[0]} - {range.z[1]}</span>
                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.z[0]}
                                onChange={(e) => setRange({ ...range, z: [e.target.value, range.z[1]] })}
                                style={{ width: '100%' }}
                            />

                            <input
                                type="range"
                                min="-20"
                                max="20"
                                step={rangeStep}
                                value={range.z[1]}
                                onChange={(e) => setRange({ ...range, z: [range.z[0], e.target.value] })}
                                style={{ width: '100%' }}
                            />


                            <br />
                            <br />

                            <button
                                onClick={() => {
                                    setScale(1);
                                    setRotation({ x: 0, y: 0, z: 0 });
                                    setTranslation({ x: 0, y: 0, z: 0 });
                                    setRange({ x: [-20, 20], y: [-20, 20], z: [-20, 20] });
                                }}
                            >Reset</button>
                        </div>
                    </div>}
                </div>
            </div>

            <Canvas
                style={{ background: 'white' }}
                gl={{ localClippingEnabled: true }}
                camera={{ fov: 50 }}
            >
                {splatData && <SplatRenderer url={splatData} calibration={calibration} range={range} />}
                {splatUrl && splatLoad && <SplatRenderer url={splatUrl} calibration={calibration} range={range} />}

                <axesHelper args={[5]} />

                <CameraUpdater axis={'N'} />

                {/* <OrbitControls
                    enableRotate={true}
                    minPolarAngle={0}
                    maxPolarAngle={Math.PI / 2}
                /> */}

                <FlyControls
                    movementSpeed={2}
                    rollSpeed={1}
                    dragToLook={true}
                />

            </Canvas>
        </div>
    );

};

export default Immersive;