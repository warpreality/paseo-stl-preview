import { useFileBytes, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { parseStl, type StlMesh } from "../shared/stl";
import { canRender, mountViewer, type Viewer, type ViewPreset } from "./web";

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const PRESET_LABELS: { id: ViewPreset; label: string }[] = [
  { id: "iso", label: "Изо" },
  { id: "front", label: "Спереди" },
  { id: "top", label: "Сверху" },
  { id: "right", label: "Справа" },
];

export function StlPanel({ file, theme, layout }: PluginFilePanelProps) {
  const bytes = useFileBytes(file);
  const parsed = useMemo((): { mesh: StlMesh } | { error: string } | null => {
    if (bytes.status !== "ready") return null;
    try {
      return { mesh: parseStl(bytes.bytes) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [bytes]);
  const mesh = parsed && "mesh" in parsed ? parsed.mesh : null;

  const hostRef = useRef<View>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);

  const colors = useMemo(
    () => ({ background: theme.colors.surface0, model: theme.colors.accent, edges: theme.colors.foreground }),
    [theme],
  );

  // Mount once the first mesh is ready; later meshes (file changed on disk) are swapped in place.
  useEffect(() => {
    if (!canRender || !mesh) return;
    if (viewerRef.current) {
      viewerRef.current.setMesh(mesh);
      return;
    }
    try {
      viewerRef.current = mountViewer(hostRef.current, mesh, colors);
      viewerRef.current.setWireframe(wireframe);
      setViewerError(null);
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : String(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh]);

  useEffect(
    () => () => {
      viewerRef.current?.dispose();
      viewerRef.current = null;
    },
    [],
  );

  useEffect(() => viewerRef.current?.setColors(colors), [colors]);
  useEffect(() => viewerRef.current?.setWireframe(wireframe), [wireframe]);

  const styles = useMemo(
    () => ({
      root: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: layout.compact ? 8 : 12,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      buttonActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      buttonText: { color: theme.colors.foreground, fontSize: 12 },
      buttonTextActive: { color: theme.colors.accentForeground, fontSize: 12 },
      spacer: { flex: 1 },
      stats: { color: theme.colors.foregroundMuted, fontSize: 12 },
      canvas: { flex: 1, minHeight: 0, position: "relative" as const, overflow: "hidden" as const },
      hint: {
        position: "absolute" as const,
        left: 10,
        bottom: 8,
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      message: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24, gap: 8 },
      messageText: { color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center" as const },
      errorText: { color: theme.colors.statusDanger, fontSize: 13, textAlign: "center" as const },
    }),
    [theme, layout.compact],
  );

  if (bytes.status === "loading" && !mesh) return <Loading />;
  if (bytes.status === "error") {
    return (
      <View style={[styles.root, styles.message]}>
        <Text style={styles.errorText}>{bytes.error.message}</Text>
      </View>
    );
  }
  if (parsed && "error" in parsed) {
    return (
      <View style={[styles.root, styles.message]}>
        <Text style={styles.errorText}>Не удалось разобрать STL: {parsed.error}</Text>
      </View>
    );
  }
  if (!mesh) return <Loading />;

  const size = [0, 1, 2].map((k) => formatNumber(mesh.max[k] - mesh.min[k])).join(" × ");
  const stats = `${size} · ${mesh.triangles.toLocaleString("ru-RU")} треуг. · ${mesh.format === "binary" ? "binary" : "ASCII"} · ${formatBytes(file.size)}`;

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        {canRender && !viewerError ? (
          <>
            {PRESET_LABELS.map((preset) => (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                accessibilityLabel={`Вид: ${preset.label}`}
                onPress={() => viewerRef.current?.setView(preset.id)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>{preset.label}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Каркас"
              accessibilityState={{ selected: wireframe }}
              onPress={() => setWireframe((on) => !on)}
              style={[styles.button, wireframe ? styles.buttonActive : null]}
            >
              <Icon name="Grid3x3" size={12} color={wireframe ? theme.colors.accentForeground : theme.colors.foreground} />
              <Text style={wireframe ? styles.buttonTextActive : styles.buttonText}>Каркас</Text>
            </Pressable>
          </>
        ) : null}
        <View style={styles.spacer} />
        <Text style={styles.stats} numberOfLines={1}>
          {stats}
        </Text>
      </View>
      {canRender && !viewerError ? (
        <View ref={hostRef} style={styles.canvas}>
          {!layout.compact ? (
            <Text style={styles.hint} pointerEvents="none">
              ЛКМ — вращать · ПКМ/Shift — сдвиг · колесо — зум · двойной клик — сброс
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.message}>
          <Icon name="Box" size={40} color={theme.colors.foregroundMuted} />
          <Text style={styles.messageText}>
            {viewerError ?? "3D-предпросмотр доступен в десктоп- и веб-приложении."}
          </Text>
          <Text style={styles.messageText}>
            Площадь поверхности: {formatNumber(mesh.area)} · объём: {formatNumber(mesh.volume)}
          </Text>
        </View>
      )}
    </View>
  );
}
