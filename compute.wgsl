// ============================================================
// compute.wgsl  —  Graph luminance reduce compute shader
//
// Kept separate from shaders.wgsl so its @group(0) bindings
// are self-contained; browsers (e.g. Firefox) require every
// @group declared in a shader module's layout to be bound at
// dispatch time, even for unused groups.
// ============================================================

struct GraphReduceCell {
    sum:   atomic<u32>,
    count: atomic<u32>,
};

struct GraphAtlasParams {
    tileWidth:  u32,
    tileHeight: u32,
    tilesX:     u32,
    tilesY:     u32,
};

@group(0) @binding(0) var                            graphTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write>       graphReduce:  array<GraphReduceCell>;
@group(0) @binding(2) var<uniform>                   graphAtlas:   GraphAtlasParams;

@compute @workgroup_size(8, 8, 1)
fn cs_reduce_graph(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(graphTexture);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }

    let texel = textureLoad(graphTexture, vec2<i32>(gid.xy), 0);
    if (texel.a <= 0.01) { return; }

    let tileX = gid.x / graphAtlas.tileWidth;
    let tileY = gid.y / graphAtlas.tileHeight;
    if (tileX >= graphAtlas.tilesX || tileY >= graphAtlas.tilesY) { return; }

    let tileIndex = tileY * graphAtlas.tilesX + tileX;
    let scaled    = u32(clamp(texel.r * 65536.0, 0.0, 4294967295.0));
    atomicAdd(&graphReduce[tileIndex].sum,   scaled);
    atomicAdd(&graphReduce[tileIndex].count, 1u);
}
