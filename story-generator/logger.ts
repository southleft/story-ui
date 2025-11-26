// Enhanced logging utility with configurable levels and MCP-safe output

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

// Get log level from environment or default to 'info'
const getConfiguredLevel = (): LogLevel => {
  const envLevel = process.env.STORY_UI_LOG_LEVEL?.toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] !== undefined ? envLevel : 'info';
};

const isMcpMode = (): boolean => {
  return process.argv.includes('mcp') || process.env.STORY_UI_MCP_MODE === 'true';
};

// Remove emojis from strings to prevent JSON parsing errors in MCP
const stripEmojis = (str: string): string => {
  return str.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{2190}-\u{21FF}]|[\u{2300}-\u{23FF}]|[\u{25A0}-\u{25FF}]|[\u{2B00}-\u{2BFF}]|[\u{3000}-\u{303F}]|✅|❌|⚠️|🔍|📦|📋|🔄|📊|⭐|🚀|💡|🎯|🔧|📌|🏃|🎨|💪|🌟|🎉|🎊|👍|👎|📝|📄|🗑️|🗂️|📁|🖥️|💻|📱|🌐|🔒|🔓|🔑|🔨|⚡|🔥|💧|🌈|☀️|🌙|⭐|✨|💫|☁️|🌧️|⛈️|❄️|☃️|⛄|🌬️|💨|🌪️|🌫️|🌊|🎯/gu, '');
};

const formatTimestamp = (): string => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
};

const formatMessage = (level: LogLevel, args: any[]): string[] => {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  const processedArgs = args.map(arg => {
    if (typeof arg === 'string') {
      return isMcpMode() ? stripEmojis(arg) : arg;
    }
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });

  return [prefix, ...processedArgs];
};

const shouldLog = (level: LogLevel): boolean => {
  const configuredLevel = getConfiguredLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
};

class Logger {
  private static instance: Logger;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  debug(...args: any[]): void {
    if (!shouldLog('debug')) return;
    const formattedArgs = formatMessage('debug', args);
    if (isMcpMode()) {
      console.error(...formattedArgs);
    } else {
      console.debug(...formattedArgs);
    }
  }

  log(...args: any[]): void {
    // Alias for info for backwards compatibility
    this.info(...args);
  }

  info(...args: any[]): void {
    if (!shouldLog('info')) return;
    const formattedArgs = formatMessage('info', args);
    if (isMcpMode()) {
      console.error(...formattedArgs);
    } else {
      console.log(...formattedArgs);
    }
  }

  warn(...args: any[]): void {
    if (!shouldLog('warn')) return;
    const formattedArgs = formatMessage('warn', args);
    if (isMcpMode()) {
      console.error(...formattedArgs);
    } else {
      console.warn(...formattedArgs);
    }
  }

  error(...args: any[]): void {
    if (!shouldLog('error')) return;
    const formattedArgs = formatMessage('error', args);
    console.error(...formattedArgs);
  }

  // Utility method for structured logging
  structured(level: LogLevel, message: string, data?: Record<string, any>): void {
    if (!shouldLog(level)) return;

    const logEntry = {
      timestamp: formatTimestamp(),
      level,
      message,
      ...(data && { data }),
    };

    if (isMcpMode()) {
      console.error(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry, null, 2));
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export for backwards compatibility with code that imports the object directly
export default logger;
