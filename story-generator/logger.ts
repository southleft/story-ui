// Utility for safe logging that doesn't corrupt MCP stdio communication

const isMcpMode = () => {
  return process.argv.includes('mcp') || process.env.STORY_UI_MCP_MODE === 'true';
};

// Remove emojis from strings to prevent JSON parsing errors in MCP
const stripEmojis = (str: string): string => {
  // Remove common emojis and unicode symbols
  return str.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{2190}-\u{21FF}]|[\u{2300}-\u{23FF}]|[\u{25A0}-\u{25FF}]|[\u{2B00}-\u{2BFF}]|[\u{3000}-\u{303F}]|✅|❌|⚠️|🔍|📦|📋|🔄|📊|⭐|🚀|💡|🎯|🔧|📌|🏃|🎨|💪|🌟|🎉|🎊|👍|👎|📝|📄|🗑️|🗂️|📁|🖥️|💻|📱|🌐|🔒|🔓|🔑|🔨|⚡|🔥|💧|🌈|☀️|🌙|⭐|✨|💫|☁️|🌧️|⛈️|❄️|☃️|⛄|🌬️|💨|🌪️|🌫️|🌊|🎯/gu, '');
};

const processArgs = (args: any[]): any[] => {
  if (!isMcpMode()) return args;
  
  return args.map(arg => {
    if (typeof arg === 'string') {
      return stripEmojis(arg);
    }
    return arg;
  });
};

export const logger = {
  log: (...args: any[]) => {
    const processedArgs = processArgs(args);
    if (isMcpMode()) {
      console.error(...processedArgs);
    } else {
      console.log(...args);
    }
  },

  error: (...args: any[]) => {
    const processedArgs = processArgs(args);
    console.error(...processedArgs);
  },

  warn: (...args: any[]) => {
    const processedArgs = processArgs(args);
    if (isMcpMode()) {
      console.error(...processedArgs);
    } else {
      console.warn(...args);
    }
  },

  info: (...args: any[]) => {
    const processedArgs = processArgs(args);
    if (isMcpMode()) {
      console.error(...processedArgs);
    } else {
      console.info(...args);
    }
  }
};
