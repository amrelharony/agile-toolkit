export interface PromptDefinition {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export interface ToolPromptConfig {
  toolName: string;
  prompts: PromptDefinition[];
}
