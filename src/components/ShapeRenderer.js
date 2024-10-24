import React from 'react';

// import { Splat } from '@react-three/drei';
import { Splat } from '../shader/Splat';

const SplatRenderer = ({ url, calibration, range = { x: [-999, 999], y: [-999, 999], z: [-999, 999] } }) => {
    const { scale, rotation, translation } = calibration;

    return (<>
        <Splat
            src={url}
            scale={scale}
            rotation={rotation}
            position={translation}
            range={range}
        />
    </>);
};

export {
    SplatRenderer
};
