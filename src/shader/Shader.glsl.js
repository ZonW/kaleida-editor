const vertexShader = `
    precision highp sampler2D;
    precision highp usampler2D;

    out vec4 vColor;
    out float vDepth;  // view depth for fragment shader
    out vec4 worldPos;
    out vec3 vPosition;
    out float scaleFactor;  // dynamic scale
    
    uniform vec2 viewport;
    uniform float focal;

    uniform vec2 uXRange;
    uniform vec2 uYRange;
    uniform vec2 uZRange;

    attribute uint splatIndex;
    uniform sampler2D centerAndScaleTexture;
    uniform usampler2D covAndColorTexture;

    vec2 unpackInt16(in uint value) {
        int v = int(value);
        int v0 = v >> 16;
        int v1 = v & 0xFFFF;
        if ((v & 0x8000) != 0)
            v1 |= 0xFFFF0000;
        return vec2(float(v1), float(v0));
    }

    void main() {        
        ivec2 texSize = textureSize(centerAndScaleTexture, 0);
        ivec2 texPos = ivec2(int(splatIndex % uint(texSize.x)), int(splatIndex / uint(texSize.x)));
        vec4 centerAndScaleData = texelFetch(centerAndScaleTexture, texPos, 0);
        vec4 center = vec4(centerAndScaleData.xyz, 1.0);

        worldPos = modelMatrix * center;
        //vec4 viewPos = viewMatrix * worldPos;
        vDepth = worldPos.z;

        if (worldPos.x < uXRange.x || worldPos.x > uXRange.y ||
            worldPos.y < uYRange.x || worldPos.y > uYRange.y ||
            worldPos.z < uZRange.x || worldPos.z > uZRange.y) {
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            return;
        }

        vec4 camspace = viewMatrix * worldPos;
        vec4 pos2d = projectionMatrix * camspace;

        float bounds = 1.2 * pos2d.w;
        if (pos2d.z < -pos2d.w || pos2d.x < -bounds || pos2d.x > bounds ||
            pos2d.y < -bounds || pos2d.y > bounds) {
            gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
            return;
        }

        uvec4 covAndColorData = texelFetch(covAndColorTexture, texPos, 0);
        vec2 cov3D_M11_M12 = unpackInt16(covAndColorData.x) * centerAndScaleData.w;
        vec2 cov3D_M13_M22 = unpackInt16(covAndColorData.y) * centerAndScaleData.w;
        vec2 cov3D_M23_M33 = unpackInt16(covAndColorData.z) * centerAndScaleData.w;
        mat3 Vrk = mat3(
            cov3D_M11_M12.x, cov3D_M11_M12.y, cov3D_M13_M22.x,
            cov3D_M11_M12.y, cov3D_M13_M22.y, cov3D_M23_M33.x,
            cov3D_M13_M22.x, cov3D_M23_M33.x, cov3D_M23_M33.y
        );

        mat3 J = mat3(
            focal / camspace.z, 0.0, -(focal * camspace.x) / (camspace.z * camspace.z),
            0.0, focal / camspace.z, -(focal * camspace.y) / (camspace.z * camspace.z),
            0.0, 0.0, 0.0
        );

        mat3 W = transpose(mat3(modelViewMatrix));
        mat3 T = W * J;
        mat3 cov = transpose(T) * Vrk * T;

        vec2 vCenter = pos2d.xy / pos2d.w;

        float diagonal1 = cov[0][0] + 0.15;
        float offDiagonal = cov[0][1];
        float diagonal2 = cov[1][1] + 0.15;

        float mid = 0.5 * (diagonal1 + diagonal2);
        float radius = length(vec2((diagonal1 - diagonal2) * 0.5, offDiagonal));
        float lambda1 = mid + radius;
        float lambda2 = max(mid - radius, 0.05);

        vec2 diagonalVector = normalize(vec2(offDiagonal, lambda1 - diagonal1));

        //#Adjust marker - maxSize - configure this for set the limit of the splat size
        float maxSize = 512.0;        
        //#Adjust marker - splatIncreaseCoeff change from 1.0 to 8.0 for more/less smoothing
        float splatIncreaseCoeff = 4.0;  // Adjust as needed
        vec2 v1 = min(sqrt(splatIncreaseCoeff * lambda1), maxSize) * diagonalVector;
        vec2 v2 = min(sqrt(splatIncreaseCoeff * lambda2), maxSize) * vec2(diagonalVector.y, -diagonalVector.x);

        uint colorUint = covAndColorData.w;
        vColor = vec4(
            float(colorUint & uint(0xFF)) / 255.0,
            float((colorUint >> uint(8)) & uint(0xFF)) / 255.0,
            float((colorUint >> uint(16)) & uint(0xFF)) / 255.0,
            float(colorUint >> uint(24)) / 255.0
        );
        vPosition = position;
        
        //#Adjust marker - value 0.25 is the default range max value for the scaleFactor, increase to 0.5 for less smoothing,
        //decrease to 0.1 for more smoothing
        float avgSize = (length(v1) + length(v2)) * 0.5;  // Average size of the splat
        scaleFactor = clamp(sqrt(avgSize) + 0.001, 0.01, 0.25);  

        // Apply resolution scaling to the final output position
        gl_Position = vec4(
            vCenter 
                + position.x * v2 / viewport * 2.0 
                + position.y * v1 / viewport * 2.0, 
            pos2d.z / pos2d.w, 
            1.0
        );
    }
`;


const fragmentShader = `

    #include <alphatest_pars_fragment>
    #include <alphahash_pars_fragment>

  
    in vec4 vColor;
    in vec3 vPosition;
    in float vDepth; 
    in float scaleFactor;  // Received from vertex shader
    in vec4 worldPos;      // World position for edge detection

    vec3 adjustColor(vec3 color, float saturationIntensity, float contrastIntensity) 
    {    
        vec3 gray = vec3(dot(color, vec3(0.3, 0.59, 0.11)));  
        vec3 saturatedColor = mix(gray, color, saturationIntensity);  // Saturation boost

        // Increase contrast
        vec3 contrastedColor = ((saturatedColor - 0.5) * contrastIntensity) + 0.5;

        // Clamp the result to prevent out-of-range values
        return clamp(contrastedColor, 0.0, 1.0);
    }
 

  
    void main() {        
        vec3 currentColor = vColor.rgb;        

        vec2 normalizedPos = vPosition.xy;
        float distanceSquared = dot(normalizedPos, normalizedPos);

        
        float falloff = exp(-distanceSquared * scaleFactor);  // Splat falloff

        //this can be adjusted by algorithm later, we can use depth value to adjust the edge factor
        float edgeFactor = 1.0;
        
        //#Adjust marker - sharpnessBias - configure this for more/less sharpness
        float sharpnessBias = 4.0;  // Adjust as needed
        falloff = mix(falloff, pow(falloff, sharpnessBias), edgeFactor);

        float baseAlpha = falloff * vColor.a;

        // Reduce blur effect near edges to preserve details
        baseAlpha = mix(baseAlpha, baseAlpha * 0.5, edgeFactor);

        // to remove messy fragments
        if (baseAlpha < 0.0) {
            discard;
        }
        
        //#Adjust marker - first number is the saturation intensity, second number is the contrast intensity 
        vec3 finalColor = adjustColor(currentColor, 0.9 ,1.0);
        
        vec4 diffuseColor = vec4(finalColor, baseAlpha);

        #include <alphatest_fragment>
        #include <alphahash_fragment>
        gl_FragColor = diffuseColor;

        #include <tonemapping_fragment>
        #include <colorspace_fragment>

        //for testint the depth value
        //gl_FragColor = vec4(0.0,abs(vDepth/20.0),0.0, 1.0);  // Use normal color    
    }
`;




export {
    vertexShader,
    fragmentShader
};
