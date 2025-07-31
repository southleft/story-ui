// Utility for safe logging that doesn't corrupt MCP stdio communication

const isMcpMode = () => {
  return process.argv.includes('mcp') || process.env.STORY_UI_MCP_MODE === 'true';
};

export const logger = {
  log: (...args: any[]) => {
    if (isMcpMode()) {
      console.error(...args);
    } else {
      console.log(...args);
    }
  },

  error: (...args: any[]) => {
    console.error(...args);
  },

  warn: (...args: any[]) => {
    if (isMcpMode()) {
      console.error(...args);
    } else {
      console.warn(...args);
    }
  },

  info: (...args: any[]) => {
    if (isMcpMode()) {
      console.error(...args);
    } else {
      console.info(...args);
    }
  }
};
