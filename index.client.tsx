import type { PluginClientContext } from "@getpaseo/plugin/client";
import { StlPanel } from "./client/StlPanel";

export default function contribute(client: PluginClientContext) {
  client.addFilePanel({
    id: "stl-preview",
    title: "STL preview",
    icon: "Box",
    files: { extensions: ["stl"] },
    Component: StlPanel,
  });
  return () => {};
}
