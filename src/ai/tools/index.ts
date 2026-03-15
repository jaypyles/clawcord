import { bashExecTool } from "./bash-exec";
import { behaviorEditorTool } from "./behavior-editor";
import { commandsRegistryTool } from "./commands-registry";
import { getTimeTool } from "./get-time";
import { httpFetchTool } from "./http-fetch";
import { memoryEditorTool } from "./memory-editor";
import { skillsReaderTool } from "./skills-reader";

export const botTools = {
  http_fetch: httpFetchTool,
  bash_exec: bashExecTool,
  memory_editor: memoryEditorTool,
  behavior_editor: behaviorEditorTool,
  commands_registry: commandsRegistryTool,
  get_time: getTimeTool,
  skills_reader: skillsReaderTool
};
