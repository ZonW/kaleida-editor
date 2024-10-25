import _extends from '@babel/runtime/helpers/esm/extends';
import * as THREE from 'three';
import * as React from 'react';
import { extend, useThree, useLoader, useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

import { vertexShader, fragmentShader } from './Shader.glsl';

//#Adjsut marker - reduce the value to 0.5 to decrease the rendering resolution and increase the speed.
//value 0.5 means that rendering resolution will be reduced 2x times by width and 2x times by height, 
//1.0 will keep existing screen resolution

const globalResolution = 0.75; //on camera move will render with lower resolution (1x by default)
const globalBackgroundColor = 0xFFFFFF;//background color
const antialiasResolution = 2.0; //on camera stop will render with higher resolution (2x default)
const syncSort = true; //if set to true sorting will be performed on the main thread
const waitForFullLoadBeforeFirstRender = false; //set to true to wait for full data load before first render
const sortThreshold = -0.0005;  // Threshold for sorting splats

//fast rendering settings
/*
  const globalResolution = 0.5;
  const antialiasResolution = 2.0; 
*/


//internal

let cameraMoveFlag = true;
let renderLock = false;


const SplatMaterial = /* @__PURE__ */shaderMaterial({
    alphaTest: 0,
    viewport: /* @__PURE__ */new THREE.Vector2(1980, 1080),
    focal: 1000.0,
    centerAndScaleTexture: null,
    covAndColorTexture: null,
    depthWrite: false,
    premultipliedAlpha: true,
    uXRange: new THREE.Vector2(-100, 100),
    uYRange: new THREE.Vector2(-100, 100),
    uZRange: new THREE.Vector2(-100, 100),
}, vertexShader, fragmentShader);

function sortSplatsSync(view, matrices) {
    const hashed = false;
    const vertexCount = matrices.length / 16;
    const threshold = sortThreshold;
    let maxDepth = -Infinity;
    let minDepth = Infinity;
    const depthList = new Float32Array(vertexCount);
    const sizeList = new Int32Array(depthList.buffer);
    const validIndexList = new Int32Array(vertexCount);
    let validCount = 0;
    for (let i = 0; i < vertexCount; i++) {
        // Sign of depth is reversed
        const depth = view[0] * matrices[i * 16 + 12] + view[1] * matrices[i * 16 + 13] + view[2] * matrices[i * 16 + 14] + view[3];
        // Skip behind of camera and small, transparent splat
        if (hashed || depth < 0 && matrices[i * 16 + 15] > threshold * depth) {
            depthList[validCount] = depth;
            validIndexList[validCount] = i;
            validCount++;
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
        }
    }

    // This is a 16 bit single-pass counting sort
    const depthInv = (256 * 256 - 1) / (maxDepth - minDepth);
    const counts0 = new Uint32Array(256 * 256);
    for (let i = 0; i < validCount; i++) {
        sizeList[i] = (depthList[i] - minDepth) * depthInv | 0;
        counts0[sizeList[i]]++;
    }
    const starts0 = new Uint32Array(256 * 256);
    for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
    const depthIndex = new Uint32Array(validCount);
    for (let i = 0; i < validCount; i++) depthIndex[starts0[sizeList[i]]++] = validIndexList[i];
    return depthIndex;

}

function createWorker(self) {
    let matrices = null;
    let offset = 0;
    function sortSplats(view, hashed = false) {
        const vertexCount = matrices.length / 16;
        const threshold = -0.0001;
        let maxDepth = -Infinity;
        let minDepth = Infinity;
        const depthList = new Float32Array(vertexCount);
        const sizeList = new Int32Array(depthList.buffer);
        const validIndexList = new Int32Array(vertexCount);
        let validCount = 0;
        for (let i = 0; i < vertexCount; i++) {
            // Sign of depth is reversed
            const depth = view[0] * matrices[i * 16 + 12] + view[1] * matrices[i * 16 + 13] + view[2] * matrices[i * 16 + 14] + view[3];
            // Skip behind of camera and small, transparent splat
            if (hashed || depth < 0 && matrices[i * 16 + 15] > threshold * depth) {
                depthList[validCount] = depth;
                validIndexList[validCount] = i;
                validCount++;
                if (depth > maxDepth) maxDepth = depth;
                if (depth < minDepth) minDepth = depth;
            }
        }

        // This is a 16 bit single-pass counting sort
        const depthInv = (256 * 256 - 1) / (maxDepth - minDepth);
        const counts0 = new Uint32Array(256 * 256);
        for (let i = 0; i < validCount; i++) {
            sizeList[i] = (depthList[i] - minDepth) * depthInv | 0;
            counts0[sizeList[i]]++;
        }
        const starts0 = new Uint32Array(256 * 256);
        for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
        const depthIndex = new Uint32Array(validCount);
        for (let i = 0; i < validCount; i++) depthIndex[starts0[sizeList[i]]++] = validIndexList[i];
        return depthIndex;
    }
    self.onmessage = e => {
        if (e.data.method == 'push') {
            if (offset === 0) matrices = new Float32Array(e.data.length);
            const new_matrices = new Float32Array(e.data.matrices);
            matrices.set(new_matrices, offset);
            offset += new_matrices.length;
        } else if (e.data.method == 'sort') {
            if (matrices !== null) {
                const indices = sortSplats(new Float32Array(e.data.view), e.data.hashed);
                // @ts-ignore
                self.postMessage({
                    indices,
                    key: e.data.key
                }, [indices.buffer]);
            }
        }
    };
}
class SplatLoader extends THREE.Loader {
    constructor(...args) {
        super(...args);
        // WebGLRenderer, needs to be filled out!
        this.gl = null;
        // Default chunk size for lazy loading
        this.chunkSize = 25000;
    }
    load(url, onLoad, onProgress, onError) {
        

        if (this.worker) {
            console.log('Terminating old worker');
            this.worker.terminate(); // Terminate the old worker
        }

        // Parse the URL to extract the base URL and unique ID
        //remove from URL params after ? 

        if (url.indexOf('?') >= 0)
            url = url.substring(0, url.indexOf('?'));

        const parsedUrl = new URL(url, window.location.href);
        let baseUrl = parsedUrl.origin + parsedUrl.pathname;

        if (window.location.href.indexOf('localhost') >= 0) {
            baseUrl = url;
        }

        const instanceId = parsedUrl.searchParams.get('instanceId');

        this.worker = new Worker(URL.createObjectURL(new Blob(['(', createWorker.toString(), ')(self)'], {
            type: 'application/javascript'
        })));

        const shared = {
            gl: this.gl,
            url: this.manager.resolveURL(baseUrl),
            mainMatrix: null,
            worker: this.worker,
            manager: this.manager,
            update: (target, camera, hashed) => update(camera, shared, target, hashed),
            connect: target => connect(shared, target),
            loading: false,
            loaded: false,
            loadedVertexCount: 0,
            chunkSize: this.chunkSize,
            totalDownloadBytes: 0,
            numVertices: 0,
            rowLength: 3 * 4 + 3 * 4 + 4 + 4,
            maxVertexes: 0,
            bufferTextureWidth: 0,
            bufferTextureHeight: 0,
            stream: null,
            centerAndScaleData: null,
            covAndColorData: null,
            covAndColorTexture: null,
            centerAndScaleTexture: null,
            onProgress
        };
        load(shared).then(onLoad).catch(e => {
            onError == null || onError(e);
            shared.manager.itemError(shared.url);
        });
    }
}
async function load(shared) {
    shared.manager.itemStart(shared.url);

    if (shared.abortController) {
        shared.abortController.abort();
    }

    shared.abortController = new AbortController();


    const data = await fetch(shared.url, {
        cache: 'force-cache' // Forces the browser to use the cache
    });

    if (data.body === null) throw 'Failed to fetch file';
    let _totalDownloadBytes = data.headers.get('Content-Length');
    const totalDownloadBytes = _totalDownloadBytes ? parseInt(_totalDownloadBytes) : undefined;
    if (totalDownloadBytes == undefined) throw 'Failed to get content length';
    shared.stream = data.body.getReader();
    shared.totalDownloadBytes = totalDownloadBytes;
    shared.numVertices = Math.floor(shared.totalDownloadBytes / shared.rowLength);
    const context = shared.gl.getContext();
    let maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE);
    shared.maxVertexes = maxTextureSize * maxTextureSize;
    if (shared.numVertices > shared.maxVertexes) shared.numVertices = shared.maxVertexes;
    shared.bufferTextureWidth = maxTextureSize;
    shared.bufferTextureHeight = Math.floor((shared.numVertices - 1) / maxTextureSize) + 1;
    shared.centerAndScaleData = new Float32Array(shared.bufferTextureWidth * shared.bufferTextureHeight * 4);
    shared.covAndColorData = new Uint32Array(shared.bufferTextureWidth * shared.bufferTextureHeight * 4);
    shared.centerAndScaleTexture = new THREE.DataTexture(shared.centerAndScaleData, shared.bufferTextureWidth, shared.bufferTextureHeight, THREE.RGBAFormat, THREE.FloatType);
    shared.centerAndScaleTexture.needsUpdate = true;
    shared.covAndColorTexture = new THREE.DataTexture(shared.covAndColorData, shared.bufferTextureWidth, shared.bufferTextureHeight, THREE.RGBAIntegerFormat, THREE.UnsignedIntType);
    shared.covAndColorTexture.internalFormat = 'RGBA32UI';
    shared.covAndColorTexture.needsUpdate = true;
    return shared;
}

async function lazyLoad(shared) {
    shared.loading = true;
    let bytesDownloaded = 0;
    let bytesProcessed = 0;
    const chunks = [];
    let lastReportedProgress = 0;
    const lengthComputable = shared.totalDownloadBytes !== 0;


    async function waitForTextures() {
        while (true) {
            const centerAndScaleTextureProperties = shared.gl.properties.get(shared.centerAndScaleTexture);
            const covAndColorTextureProperties = shared.gl.properties.get(shared.covAndColorTexture);

            if (
                centerAndScaleTextureProperties &&
                centerAndScaleTextureProperties.__webglTexture &&
                covAndColorTextureProperties &&
                covAndColorTextureProperties.__webglTexture
            ) {
                break; // Textures are ready
            }

            await new Promise(resolve => setTimeout(resolve, 10)); // Delay and wait for textures
        }
    }

    // Wait for textures to be ready
    await waitForTextures();

    renderLock = true;
    cameraMoveFlag = true;
    let mainThreadMatrices = new Float32Array(shared.numVertices * 16);
    let offsetMain = 0;

    while (true) {
        try {
            const { value, done } = await shared.stream.read();
            if (done) break;
            bytesDownloaded += value.length;
            if (shared.totalDownloadBytes != undefined) {
                const percent = bytesDownloaded / shared.totalDownloadBytes * 100;
                if (shared.onProgress && percent - lastReportedProgress > 1) {
                    const event = new ProgressEvent('progress', {
                        lengthComputable,
                        loaded: bytesDownloaded,
                        total: shared.totalDownloadBytes
                    });
                    shared.onProgress(event);
                    lastReportedProgress = percent;
                }
            }
            chunks.push(value);
            const bytesRemains = bytesDownloaded - bytesProcessed;
            if (shared.totalDownloadBytes != undefined && bytesRemains > shared.rowLength * shared.chunkSize) {
                let vertexCount = Math.floor(bytesRemains / shared.rowLength);
                const concatenatedChunksbuffer = new Uint8Array(bytesRemains);
                let offset = 0;
                for (const chunk of chunks) {
                    concatenatedChunksbuffer.set(chunk, offset);
                    offset += chunk.length;
                }
                chunks.length = 0;
                if (bytesRemains > vertexCount * shared.rowLength) {
                    const extra_data = new Uint8Array(bytesRemains - vertexCount * shared.rowLength);
                    extra_data.set(concatenatedChunksbuffer.subarray(bytesRemains - extra_data.length, bytesRemains), 0);
                    chunks.push(extra_data);
                }
                const buffer = new Uint8Array(vertexCount * shared.rowLength);
                buffer.set(concatenatedChunksbuffer.subarray(0, buffer.byteLength), 0);

                // Push data only after textures are ready
                const matrices = pushDataBuffer(shared, buffer.buffer, vertexCount);



                bytesProcessed += vertexCount * shared.rowLength;

                let onend = (bytesDownloaded - bytesProcessed) == 0;

                const new_matrices = new Float32Array(matrices);
                if (!mainThreadMatrices)
                    break;
                mainThreadMatrices.set(new_matrices, offsetMain);
                offsetMain += new_matrices.length;

                shared.mainMatrix = mainThreadMatrices;

                shared.worker.postMessage({
                    method: 'push',
                    src: shared.url,
                    onend: onend,
                    length: shared.numVertices * 16,
                    matrices: matrices.buffer
                }, [matrices.buffer]);

                if (shared.onProgress) {
                    const event = new ProgressEvent('progress', {
                        lengthComputable,
                        loaded: shared.totalDownloadBytes,
                        total: shared.totalDownloadBytes
                    });
                    shared.onProgress(event);
                }
            }
        } catch (error) {
            console.error(error);
            break;
        }
    }
    if (bytesDownloaded - bytesProcessed > 0 && mainThreadMatrices) {
        let concatenatedChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            concatenatedChunks.set(chunk, offset);
            offset += chunk.length;
        }
        let numVertices = Math.floor(concatenatedChunks.byteLength / shared.rowLength);

        // Push data only after textures are ready
        const matrices = pushDataBuffer(shared, concatenatedChunks.buffer, numVertices);

        const new_matrices = new Float32Array(matrices);
        mainThreadMatrices.set(new_matrices, offsetMain);
        offsetMain += new_matrices.length;

        console.log('Full data loaded (2)');


        shared.worker.postMessage({
            method: 'push',
            src: shared.url,
            length: numVertices * 16,
            onend: true,
            matrices: matrices.buffer
        }, [matrices.buffer]);
    }
    else
        console.log('Full data loaded (1)');

    renderLock = false;
    shared.loading = false;
    shared.loaded = true;
    shared.manager.itemEnd(shared.url);
}

function update(camera, shared, target, hashed) {
    camera.updateMatrixWorld();
    shared.gl.getCurrentViewport(target.viewport);
    // @ts-ignore
    target.material.viewport.x = target.viewport.z;
    // @ts-ignore
    target.material.viewport.y = target.viewport.w;
    target.material.focal = target.viewport.w / 2.0 * Math.abs(camera.projectionMatrix.elements[5]);
    if (target.ready) {
        if (hashed && target.sorted) return;
        target.ready = false;
        const view = new Float32Array([target.modelViewMatrix.elements[2], -target.modelViewMatrix.elements[6], target.modelViewMatrix.elements[10], target.modelViewMatrix.elements[14]]);
        shared.worker.postMessage({
            method: 'sort',
            src: shared.url,
            key: target.uuid,
            view: view.buffer,
            hashed
        }, [view.buffer]);
        if (hashed && shared.loaded) target.sorted = true;
    }
}
function connect(shared, target) {
    if (!shared.loading)
        lazyLoad(shared);
    target.ready = false;
    target.pm = new THREE.Matrix4();
    target.vm1 = new THREE.Matrix4();
    target.vm2 = new THREE.Matrix4();
    target.viewport = new THREE.Vector4();
    let splatIndexArray = new Uint32Array(shared.bufferTextureWidth * shared.bufferTextureHeight);
    const splatIndexes = new THREE.InstancedBufferAttribute(splatIndexArray, 1, false);
    splatIndexes.setUsage(THREE.DynamicDrawUsage);
    const geometry = target.geometry = new THREE.InstancedBufferGeometry();
    const positionsArray = new Float32Array(6 * 3);
    const positions = new THREE.BufferAttribute(positionsArray, 3);
    geometry.setAttribute('position', positions);
    positions.setXYZ(2, -2.0, 2.0, 0.0);
    positions.setXYZ(1, 2.0, 2.0, 0.0);
    positions.setXYZ(0, -2.0, -2.0, 0.0);
    positions.setXYZ(5, -2.0, -2.0, 0.0);
    positions.setXYZ(4, 2.0, 2.0, 0.0);
    positions.setXYZ(3, 2.0, -2.0, 0.0);
    positions.needsUpdate = true;
    geometry.setAttribute('splatIndex', splatIndexes);
    geometry.instanceCount = 1;
    function listener(e) {
        if (target && e.data.key === target.uuid) {
            let indexes = new Uint32Array(e.data.indices);
            // @ts-ignore
            geometry.attributes.splatIndex.set(indexes);
            geometry.attributes.splatIndex.needsUpdate = true;
            geometry.instanceCount = indexes.length;
            target.ready = true;
        }
    }
    shared.worker.addEventListener('message', listener);
    
    async function wait() {
        while (true) {
            const centerAndScaleTextureProperties = shared.gl.properties.get(shared.centerAndScaleTexture);
            const covAndColorTextureProperties = shared.gl.properties.get(shared.covAndColorTexture);
            if (centerAndScaleTextureProperties != null && centerAndScaleTextureProperties.__webglTexture && covAndColorTextureProperties != null && covAndColorTextureProperties.__webglTexture && shared.loadedVertexCount > 0) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        target.ready = true;
    }
    wait();
    return () => shared.worker.removeEventListener('message', listener);
}
function pushDataBuffer(shared, buffer, vertexCount) {

    console.log('Pushing data buffer');
    const context = shared.gl.getContext();

    // Ensure the number of vertices doesn't exceed the maximum allowed vertex count
    if (shared.loadedVertexCount + vertexCount > shared.maxVertexes) {
        vertexCount = shared.maxVertexes - shared.loadedVertexCount;
    }
    if (vertexCount <= 0) {
        throw 'Failed to parse file: No vertices to process.';
    }

    const u_buffer = new Uint8Array(buffer);
    const f_buffer = new Float32Array(buffer);
    const matrices = new Float32Array(vertexCount * 16);

    const covAndColorData_uint8 = new Uint8Array(shared.covAndColorData.buffer);
    const covAndColorData_int16 = new Int16Array(shared.covAndColorData.buffer);



    for (let i = 0; i < vertexCount; i++) {
        const quat = new THREE.Quaternion(-(u_buffer[32 * i + 28 + 1] - 128) / 128.0, (u_buffer[32 * i + 28 + 2] - 128) / 128.0, (u_buffer[32 * i + 28 + 3] - 128) / 128.0, -(u_buffer[32 * i + 28 + 0] - 128) / 128.0);
        quat.invert();
        const center = new THREE.Vector3(f_buffer[8 * i + 0], f_buffer[8 * i + 1], -f_buffer[8 * i + 2]);
        const scale = new THREE.Vector3(f_buffer[8 * i + 3 + 0], f_buffer[8 * i + 3 + 1], f_buffer[8 * i + 3 + 2]);
        const mtx = new THREE.Matrix4();
        mtx.makeRotationFromQuaternion(quat);
        mtx.transpose();
        mtx.scale(scale);
        const mtx_t = mtx.clone();
        mtx.transpose();
        mtx.premultiply(mtx_t);
        mtx.setPosition(center);
        const cov_indexes = [0, 1, 2, 5, 6, 10];
        let max_value = 0.0;
        for (let j = 0; j < cov_indexes.length; j++) if (Math.abs(mtx.elements[cov_indexes[j]]) > max_value) max_value = Math.abs(mtx.elements[cov_indexes[j]]);
        let destOffset = shared.loadedVertexCount * 4 + i * 4;
        shared.centerAndScaleData[destOffset + 0] = center.x;
        shared.centerAndScaleData[destOffset + 1] = -center.y;
        shared.centerAndScaleData[destOffset + 2] = center.z;
        shared.centerAndScaleData[destOffset + 3] = max_value / 32767.0;
        destOffset = shared.loadedVertexCount * 8 + i * 4 * 2;
        for (let j = 0; j < cov_indexes.length; j++) covAndColorData_int16[destOffset + j] = mtx.elements[cov_indexes[j]] * 32767.0 / max_value;

        // RGBA
        destOffset = shared.loadedVertexCount * 16 + (i * 4 + 3) * 4;
        const col = new THREE.Color(u_buffer[32 * i + 24 + 0] / 255, u_buffer[32 * i + 24 + 1] / 255, u_buffer[32 * i + 24 + 2] / 255);
        col.convertSRGBToLinear();
        covAndColorData_uint8[destOffset + 0] = col.r * 255;
        covAndColorData_uint8[destOffset + 1] = col.g * 255;
        covAndColorData_uint8[destOffset + 2] = col.b * 255;
        covAndColorData_uint8[destOffset + 3] = u_buffer[32 * i + 24 + 3];

        // Store scale and transparent to remove splat in sorting process
        mtx.elements[15] = Math.max(scale.x, scale.y, scale.z) * u_buffer[32 * i + 24 + 3] / 255.0;
        for (let j = 0; j < 16; j++) matrices[i * 16 + j] = mtx.elements[j];
    }
    // Update textures in small chunks
    let remainingVertices = vertexCount;
    let loadedVertices = shared.loadedVertexCount;
    while (remainingVertices > 0) {
        let xoffset = loadedVertices % shared.bufferTextureWidth;
        let yoffset = Math.floor(loadedVertices / shared.bufferTextureWidth);
        let width = Math.min(shared.bufferTextureWidth - xoffset, remainingVertices);
        let height = 1;

        const centerAndScaleTextureProperties = shared.gl.properties.get(shared.centerAndScaleTexture);
        const covAndColorTextureProperties = shared.gl.properties.get(shared.covAndColorTexture);


        // Ensure the texture is bound correctly before updating
        if (centerAndScaleTextureProperties && centerAndScaleTextureProperties.__webglTexture) {
            context.bindTexture(context.TEXTURE_2D, centerAndScaleTextureProperties.__webglTexture);
            context.texSubImage2D(
                context.TEXTURE_2D,
                0,
                xoffset,
                yoffset,
                width,
                height,
                context.RGBA,
                context.FLOAT,
                shared.centerAndScaleData,
                loadedVertices * 4
            );
        } else {
            console.error('Error: centerAndScaleTexture not bound correctly');
        }

        if (covAndColorTextureProperties && covAndColorTextureProperties.__webglTexture) {
            context.bindTexture(context.TEXTURE_2D, covAndColorTextureProperties.__webglTexture);
            context.texSubImage2D(
                context.TEXTURE_2D,
                0,
                xoffset,
                yoffset,
                width,
                height,
                context.RGBA_INTEGER,
                context.UNSIGNED_INT,
                shared.covAndColorData,
                loadedVertices * 4
            );
        } else {
            console.error('Error: covAndColorTexture not bound correctly');
        }

        shared.gl.resetState();

        loadedVertices += width * height;
        remainingVertices -= width * height;
    }

    shared.loadedVertexCount += vertexCount;

    return matrices;
}

//Post processing layer
const blurAndSharpenMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: null },  // Input texture
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        blurRadius: { value: 1.0 },  //#Adjust marker - Blur radius for second layer rendering
        sharpenStrength: { value: 3.0 },  //#Adjust marker - Sharpen strength for second layer rendering
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float blurRadius;
    uniform float sharpenStrength;

    varying vec2 vUv;

    // Gaussian blur kernel weights
    const float kernel[5] = float[5](0.06136, 0.24477, 0.38774, 0.24477, 0.06136);

    // 1. Apply Gaussian Blur
    vec3 applyGaussianBlur(vec2 uv) {
        vec3 color = vec3(0.0);

        for (int i = -2; i <= 2; i++) {
            for (int j = -2; j <= 2; j++) {
                vec2 offset = vec2(float(i), float(j)) * blurRadius / resolution;
                color += texture2D(tDiffuse, uv + offset).rgb * kernel[2 + i] * kernel[2 + j];
            }
        }

        return color;
    }

    // 2. Apply Sharpening
    vec3 applySharpen(vec2 uv, vec3 originalColor, vec3 blurredColor) {
        vec3 sharpColor = originalColor + sharpenStrength * (originalColor - blurredColor);  // Unsharp masking
        return sharpColor;
    }

     vec3 linearToSrgb(vec3 color) {
        return pow(color, vec3(1.0 / 2.2));
    }

    void main() {
        vec3 originalColor = texture2D(tDiffuse, vUv).rgb;  // Original image
        vec3 blurredColor = applyGaussianBlur(vUv);  // Blur the image

        // Sharpen the image based on the original and blurred result
        vec3 finalColor = applySharpen(vUv, originalColor, blurredColor);

        #include <alphatest_fragment>
        #include <alphahash_fragment>
        gl_FragColor = vec4(finalColor,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>

    }
    `,
});

const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth * globalResolution, window.innerHeight * globalResolution, {
    format: THREE.RGBAFormat,
});

const renderTargetAntialias = new THREE.WebGLRenderTarget(window.innerWidth * antialiasResolution, window.innerHeight * antialiasResolution, {
    format: THREE.RGBAFormat,
});


const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    blurAndSharpenMaterial
);
const scenePost = new THREE.Scene();
scenePost.add(quad);


function Splat({
    src,
    toneMapped = false,
    alphaTest = 0,
    alphaHash = false,
    chunkSize = 25000,
    pixelRatio = 1.0,
    range = { x: [-999, 999], y: [-999, 999], z: [-999, 999] },
    ...props
}) {
    extend({
        SplatMaterial
    });

    React.useEffect(() => {
        const sharedConnection = shared.connect(ref.current);

        // Cleanup on unmount or when src changes
        return () => {
            if (shared.worker) {
                shared.worker.terminate();
            }
            sharedConnection();
        };
    }, [src]);

    const ref = React.useRef(null);
    const gl = useThree(state => state.gl);



    //const url = React.useMemo(() => src, [src]); // Memoize to prevent unnecessary re-renders

    //check if src is not changed

    /*let forceReloadUrl = `${src}?t=${new Date().getTime()}`;
    if (!src.startsWith('blob'))
    {
        if (window.lastLoadedURL !== src) {
            window.lastLoadedURL = src;
            window.lastLoadedURLForce = forceReloadUrl;
        }
        else
            forceReloadUrl = window.lastLoadedURLForce;
    }
    else
        forceReloadUrl = src;*/


    const shared = useLoader(SplatLoader, src, loader => {
        loader.gl = gl;
        loader.chunkSize = chunkSize;
    });    

            

    React.useEffect(() => {
        const sharedConnection = shared.connect(ref.current);

        // Cleanup on unmount or when src changes
        return () => {
            if (shared.worker) {
                shared.worker.terminate();
            }
            sharedConnection();
        };
    }, [src]);

    
    

    gl.autoClear = false;
    gl.autoClearColor = false;
    gl.setClearColor(globalBackgroundColor, 1.0);
    const glState = useThree(state => state);
    const camera = useThree(state => state.camera);

    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);


    gl.setPixelRatio(pixelRatio);

    const isSceneMoving = React.useRef(true);
    let sortInterval = 0;

    let currentIndicesBuffer = new Uint32Array(0);  // Buffer used for rendering
    let nextIndicesBuffer = new Uint32Array(0);     // Buffer used for sorting in the background
    let useNextBuffer = false;

    let lastCameraPosition = new THREE.Vector3();
    let lastCameraRotation = new THREE.Quaternion();
    let lastMoveTime = Date.now();
    const movementTimeout = 200;

    // Check if the camera has moved
    const checkCameraMovement = () => {
        const currentCameraPosition = new THREE.Vector3().copy(camera.position);
        const currentCameraRotation = new THREE.Quaternion().copy(camera.quaternion);

        // If camera moved more than a small threshold, update the last move time
        if (!currentCameraPosition.equals(lastCameraPosition) || !currentCameraRotation.equals(lastCameraRotation)) {
            lastMoveTime = Date.now();
            lastCameraPosition.copy(currentCameraPosition);
            lastCameraRotation.copy(currentCameraRotation);
        }

        // If the camera hasn't moved for more than 100 ms, log it
        if (Date.now() - lastMoveTime > movementTimeout) {
            return false;
        }
        return true;
    };


    useFrame(() => {

        if (waitForFullLoadBeforeFirstRender)
            if (renderLock) return;


        if (ref.current && shared.centerAndScaleTexture && shared.covAndColorTexture) {
            // State to track the camera movement

            let selectedTarget = renderTarget;

            if (!checkCameraMovement() && !renderLock) {
                //console.log('Camera is not moving');
                if (cameraMoveFlag) {
                    selectedTarget = renderTargetAntialias;
                }
                else {
                    glState.scene.visible = false;
                    return;
                }
                cameraMoveFlag = false;
            }
            else {
                cameraMoveFlag = true;
                //console.log('Camera is moving');
            }


            if (syncSort && shared.mainMatrix) {
                camera.updateMatrixWorld();
                camera.updateProjectionMatrix();
                glState.gl.getCurrentViewport(ref.current.viewport);
                ref.current.material.viewport.x = ref.current.viewport.z;
                ref.current.material.viewport.y = ref.current.viewport.w;
                ref.current.material.focal = ref.current.viewport.w / 2.0 * Math.abs(camera.projectionMatrix.elements[5]);

                const view = new Float32Array([
                    ref.current.modelViewMatrix.elements[2],
                    -ref.current.modelViewMatrix.elements[6],
                    ref.current.modelViewMatrix.elements[10],
                    ref.current.modelViewMatrix.elements[14]
                ]);

                // Sort into the next buffer
                nextIndicesBuffer = sortSplatsSync(view, shared.mainMatrix);

                // Set the flag to indicate that we have new sorted data
                useNextBuffer = true;
            } else {
                // Asynchronous sorting using worker
                shared.update(ref.current, camera, alphaHash);
            }

            // If there is new sorted data, swap the buffers
            if (useNextBuffer) {
                // Apply the sorted indices from the next buffer to the geometry
                const geometry = ref.current.geometry;
                geometry.attributes.splatIndex.set(nextIndicesBuffer);
                geometry.attributes.splatIndex.needsUpdate = true;
                geometry.instanceCount = nextIndicesBuffer.length;

                // Swap the buffers
                currentIndicesBuffer = nextIndicesBuffer;
                useNextBuffer = false;  // Reset the flag after swapping
            }

            ref.current.material.uniforms.viewport.value.x = glState.size.width;
            ref.current.material.uniforms.viewport.value.y = glState.size.height;


            glState.gl.setRenderTarget(selectedTarget);
            glState.gl.setClearColor(0, 1.0);
            glState.gl.clear();  // Clear the render target
            glState.gl.render(ref.current, camera);  // Render the scene to the render target

            glState.gl.setRenderTarget(null);

            // Apply post-processing: Bilateral filter or other effects
            blurAndSharpenMaterial.uniforms.tDiffuse.value = selectedTarget.texture;
            blurAndSharpenMaterial.uniforms.resolution.value.x = glState.size.width;
            blurAndSharpenMaterial.uniforms.resolution.value.y = glState.size.height;

            glState.gl.setClearColor(globalBackgroundColor, 1.0);
            glState.gl.clear();  // Clear the screen
            const orthoCamera = new THREE.OrthographicCamera(
                -1, 1, 1, -1, 0.1, 10
            );
            orthoCamera.position.z = 1;  // Set the camera position
            glState.gl.render(scenePost, orthoCamera);  // Render the processed scene to the screen

            glState.scene.visible = false;  // Hide the scene


            ref.current.material.uniforms.viewport.needsUpdate = true;
            ref.current.material.uniforms.focal.needsUpdate = true;



            ref.current.material.needsUpdate = true;


            isSceneMoving.current = true;
        }
    });


    // Function to handle window resize
    React.useEffect(() => {
        const handleResize = () => {

            // Update resolution uniform
            if (ref.current) {
                const width = window.innerWidth;
                const height = window.innerHeight;

                // Resize render target
                renderTarget.setSize(width * globalResolution, height * globalResolution);
                renderTargetAntialias.setSize(width * antialiasResolution, height * antialiasResolution);

                blurAndSharpenMaterial.uniforms.resolution.value.x = width;
                blurAndSharpenMaterial.uniforms.resolution.value.y = height;

                // Update the material uniforms to match the new size

                ref.current.material.uniforms.viewport.value.x = width;
                ref.current.material.uniforms.viewport.value.y = height;

                ref.current.material.uniforms.viewport.needsUpdate = true;
            }
        };

        // Add the event listener for window resize
        window.addEventListener('resize', handleResize);

        // Clean up the event listener on component unmount
        return () => window.removeEventListener('resize', handleResize);
    }, []);



    //React.useLayoutEffect(() => shared.connect(ref.current), [src]);

    return (
        <mesh ref={ref} frustumCulled={false} {...props}>
            <splatMaterial
                key={`${src}/${alphaTest}/${alphaHash}${SplatMaterial.key}`}
                transparent={!alphaHash}
                depthTest
                alphaTest={alphaHash ? 0 : alphaTest}
                centerAndScaleTexture={shared.centerAndScaleTexture}
                covAndColorTexture={shared.covAndColorTexture}
                depthWrite={alphaHash ? true : alphaTest > 0}
                blending={alphaHash ? THREE.NormalBlending : THREE.CustomBlending}
                blendSrcAlpha={THREE.OneFactor}
                alphaHash={!!alphaHash}
                toneMapped={toneMapped}
            />
        </mesh>
    )

}
export { Splat };
