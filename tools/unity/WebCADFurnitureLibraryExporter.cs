#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class WebCADFurnitureLibraryExporter
{
    const string PrefabRoot = "Assets/Furniture Mega Pack/Prefabs";
    const string PlannerRoot = "/Users/nariiwa/Documents/GitHub/webcad-planner";
    const string OutputRoot = PlannerRoot + "/assets/models/furniture_mega";
    const int TopSize = 512;
    const int ThumbSize = 256;
    const float MinFootprint = 0.22f;
    const float MinHeight = 0.12f;

    static readonly HashSet<string> ExcludedFolders = new HashSet<string> { "Cushioins" };
    static readonly string[] ExcludedPrefixes = { "TowelHanger", "TissueHanger" };

    [MenuItem("WebCAD/Export Furniture Mega Library", false, 120)]
    public static async void ExportFurnitureMegaLibraryMenu()
    {
        await ExportAllAsync(exitWhenDone: false);
    }

    public static async void ExportFurnitureMegaLibraryBatch()
    {
        try
        {
            await ExportAllAsync(exitWhenDone: true);
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogException(ex);
            EditorApplication.Exit(1);
        }
    }

    static async Task ExportAllAsync(bool exitWhenDone)
    {
        Directory.CreateDirectory(OutputRoot);
        Directory.CreateDirectory(Path.Combine(OutputRoot, "glb"));
        Directory.CreateDirectory(Path.Combine(OutputRoot, "top"));
        Directory.CreateDirectory(Path.Combine(OutputRoot, "thumb"));

        var paths = AssetDatabase.FindAssets("t:Prefab", new[] { PrefabRoot })
            .Select(AssetDatabase.GUIDToAssetPath)
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();

        var bedBounds = MeasurePrefab("Assets/Furniture Mega Pack/Prefabs/Beds/Bed01.prefab");
        var bedLong = Mathf.Max(bedBounds.size.x, bedBounds.size.z);
        var mmPerUnity = bedLong > 0.001f ? 1950f / bedLong : 1000f;

        var entries = new List<Entry>();
        var tempScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        foreach (var path in paths)
        {
            var folder = Path.GetFileName(Path.GetDirectoryName(path));
            var name = Path.GetFileNameWithoutExtension(path);
            if (ShouldSkipByName(folder, name)) continue;

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) continue;

            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null) continue;
            SceneManager.MoveGameObjectToScene(instance, tempScene);
            instance.transform.position = Vector3.zero;
            instance.transform.rotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;

            var bounds = ComputeBounds(instance);
            if (!bounds.HasValue || ShouldSkipByBounds(bounds.Value))
            {
                UnityEngine.Object.DestroyImmediate(instance);
                continue;
            }

            var modelPath = Path.Combine(OutputRoot, "glb", name + ".glb");
            var topPath = Path.Combine(OutputRoot, "top", name + ".png");
            var thumbPath = Path.Combine(OutputRoot, "thumb", name + ".png");

            await WebCADGltfExporter.ExportRoot(instance, modelPath);
            Capture(instance, bounds.Value, topPath, TopSize, true);
            Capture(instance, bounds.Value, thumbPath, ThumbSize, false);

            var cls = Classify(folder, name);
            entries.Add(new Entry
            {
                id = "fmp-" + name,
                name = name,
                group = cls.group,
                category = cls.category,
                sourceFolder = folder,
                prefabPath = path,
                model = Rel(modelPath),
                top = Rel(topPath),
                thumb = Rel(thumbPath),
                w = Mathf.Max(100, Mathf.RoundToInt(bounds.Value.size.x * mmPerUnity)),
                d = Mathf.Max(100, Mathf.RoundToInt(bounds.Value.size.z * mmPerUnity)),
                h = Mathf.Max(50, Mathf.RoundToInt(bounds.Value.size.y * mmPerUnity))
            });

            UnityEngine.Object.DestroyImmediate(instance);
        }

        WriteManifest(entries, mmPerUnity);
        AssetDatabase.Refresh();
        Debug.Log($"WebCAD furniture library export finished: {entries.Count} entries -> {OutputRoot}");
        if (!exitWhenDone) EditorUtility.RevealInFinder(OutputRoot);
    }

    static Bounds MeasurePrefab(string path)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
        instance.transform.position = Vector3.zero;
        instance.transform.rotation = Quaternion.identity;
        instance.transform.localScale = Vector3.one;
        var bounds = ComputeBounds(instance) ?? new Bounds(Vector3.zero, Vector3.one);
        UnityEngine.Object.DestroyImmediate(instance);
        return bounds;
    }

    static bool ShouldSkipByName(string folder, string name)
    {
        if (ExcludedFolders.Contains(folder)) return true;
        return ExcludedPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
    }

    static bool ShouldSkipByBounds(Bounds b)
    {
        var footprint = Mathf.Max(b.size.x, b.size.z);
        return footprint < MinFootprint || b.size.y < MinHeight;
    }

    static Bounds? ComputeBounds(GameObject root)
    {
        var renderers = root.GetComponentsInChildren<Renderer>(true)
            .Where(r => r.enabled && !(r is ParticleSystemRenderer))
            .ToList();
        if (renderers.Count == 0) return null;
        var b = renderers[0].bounds;
        for (var i = 1; i < renderers.Count; i++) b.Encapsulate(renderers[i].bounds);
        return b;
    }

    static (string group, string category) Classify(string folder, string name)
    {
        if (folder == "Bathroom")
        {
            if (name.StartsWith("BathTub")) return ("住設", "バスルーム");
            if (name.StartsWith("BathroomVanity") || name.StartsWith("WashBasin")) return ("住設", "洗面台");
            if (name.StartsWith("Toilet")) return ("住設", "トイレ");
            if (name.StartsWith("ShowerSystem")) return ("住設", "シャワー");
            return ("住設", "バスルーム");
        }
        if (folder == "Kitchen")
        {
            if (name.Contains("_Sink")) return ("住設", "キッチン/シンク");
            if (name.StartsWith("GasStove")) return ("住設", "キッチン/コンロ");
            if (name.StartsWith("Refrigerator")) return ("住設", "冷蔵庫");
            return ("住設", "キッチン収納");
        }
        if (folder == "Beds") return ("家具", "ベッド");
        if (folder == "Chairs") return ("家具", "チェア");
        if (folder == "Closets") return ("家具", "収納");
        if (folder == "Drawers") return ("家具", "引き出し");
        if (folder == "Sofas") return ("家具", "ソファ");
        if (folder == "Tables") return ("家具", "テーブル");
        return ("家具", folder);
    }

    static void Capture(GameObject target, Bounds bounds, string path, int size, bool top)
    {
        var camGo = new GameObject("WebCAD Capture Camera");
        var lightGo = new GameObject("WebCAD Capture Light");
        try
        {
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0, 0, 0, 0);
            cam.orthographic = true;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 100f;

            var center = bounds.center;
            var radius = Mathf.Max(bounds.extents.x, bounds.extents.y, bounds.extents.z, 0.1f);
            if (top)
            {
                camGo.transform.position = center + Vector3.up * (radius * 4f + 2f);
                camGo.transform.rotation = Quaternion.Euler(90f, 0, 0);
                cam.orthographicSize = Mathf.Max(bounds.extents.x, bounds.extents.z) * 1.12f;
            }
            else
            {
                var dir = new Vector3(1.25f, 0.85f, -1.15f).normalized;
                camGo.transform.position = center + dir * (radius * 4.2f + 1.5f);
                camGo.transform.LookAt(center);
                cam.orthographicSize = radius * 1.55f;
            }

            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            lightGo.transform.rotation = Quaternion.Euler(45f, -35f, 0);

            var rt = new RenderTexture(size, size, 24, RenderTextureFormat.ARGB32);
            cam.targetTexture = rt;
            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            cam.Render();
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
            tex.ReadPixels(new Rect(0, 0, size, size), 0, 0);
            tex.Apply();
            var cropped = CropTransparent(tex, 8);
            File.WriteAllBytes(path, cropped.EncodeToPNG());
            RenderTexture.active = prev;
            cam.targetTexture = null;
            if (cropped != tex) UnityEngine.Object.DestroyImmediate(cropped);
            UnityEngine.Object.DestroyImmediate(tex);
            UnityEngine.Object.DestroyImmediate(rt);
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(camGo);
            UnityEngine.Object.DestroyImmediate(lightGo);
        }
    }

    static Texture2D CropTransparent(Texture2D src, int pad)
    {
        var pixels = src.GetPixels32();
        var minX = src.width;
        var minY = src.height;
        var maxX = -1;
        var maxY = -1;
        for (var y = 0; y < src.height; y++)
        {
            for (var x = 0; x < src.width; x++)
            {
                if (pixels[y * src.width + x].a <= 4) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX || maxY < minY) return src;
        minX = Mathf.Max(0, minX - pad);
        minY = Mathf.Max(0, minY - pad);
        maxX = Mathf.Min(src.width - 1, maxX + pad);
        maxY = Mathf.Min(src.height - 1, maxY + pad);
        var w = maxX - minX + 1;
        var h = maxY - minY + 1;
        if (w == src.width && h == src.height) return src;
        var dst = new Texture2D(w, h, TextureFormat.RGBA32, false);
        dst.SetPixels32(src.GetPixels32(minX, minY, w, h));
        dst.Apply();
        return dst;
    }

    static string Rel(string abs)
    {
        return abs.Replace(PlannerRoot + "/", "").Replace("\\", "/");
    }

    static void WriteManifest(List<Entry> entries, float mmPerUnity)
    {
        var sb = new StringBuilder();
        sb.Append("{\n");
        sb.Append("  \"version\": 1,\n");
        sb.AppendFormat(CultureInfo.InvariantCulture, "  \"mmPerUnity\": {0:0.###},\n", mmPerUnity);
        sb.Append("  \"items\": [\n");
        for (var i = 0; i < entries.Count; i++)
        {
            var e = entries[i];
            sb.Append("    {");
            sb.Append($"\"id\":\"{Json(e.id)}\",");
            sb.Append($"\"name\":\"{Json(e.name)}\",");
            sb.Append($"\"group\":\"{Json(e.group)}\",");
            sb.Append($"\"category\":\"{Json(e.category)}\",");
            sb.Append($"\"sourceFolder\":\"{Json(e.sourceFolder)}\",");
            sb.Append($"\"prefabPath\":\"{Json(e.prefabPath)}\",");
            sb.Append($"\"model\":\"{Json(e.model)}\",");
            sb.Append($"\"top\":\"{Json(e.top)}\",");
            sb.Append($"\"thumb\":\"{Json(e.thumb)}\",");
            sb.Append($"\"w\":{e.w},\"d\":{e.d},\"h\":{e.h}");
            sb.Append("}");
            if (i < entries.Count - 1) sb.Append(",");
            sb.Append("\n");
        }
        sb.Append("  ]\n");
        sb.Append("}\n");
        File.WriteAllText(Path.Combine(OutputRoot, "manifest.json"), sb.ToString(), new UTF8Encoding(false));
    }

    static string Json(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    class Entry
    {
        public string id;
        public string name;
        public string group;
        public string category;
        public string sourceFolder;
        public string prefabPath;
        public string model;
        public string top;
        public string thumb;
        public int w;
        public int d;
        public int h;
    }
}
#endif
