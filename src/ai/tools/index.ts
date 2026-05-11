import { bashExecTool } from "./bash-exec";
import { behaviorEditorTool } from "./behavior-editor";
import { commandsRegistryTool } from "./commands-registry";
import { createFileTool } from "./create-file";
import { editFileTool } from "./edit-file";
import { getTimeTool } from "./get-time";
import { httpFetchTool } from "./http-fetch";
import { moveFileTool } from "./move-file";
import { memoryEditorTool } from "./memory-editor";
import { scheduleEditorTool } from "./schedule-editor";
import { skillsEditorTool } from "./skills-editor";
import { skillsReaderTool } from "./skills-reader";

export const botTools = {
  http_fetch: httpFetchTool,
  create_file: createFileTool,
  edit_file: editFileTool,
  move_file: moveFileTool,
  bash_exec: bashExecTool,
  memory_editor: memoryEditorTool,
  behavior_editor: behaviorEditorTool,
  commands_registry: commandsRegistryTool,
  get_time: getTimeTool,
  skills_reader: skillsReaderTool,
  skills_editor: skillsEditorTool,
  schedule_editor: scheduleEditorTool
};
