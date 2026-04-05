import chalk from "chalk";

type LogLevel = "silent" | "error" | "warn" | "success" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  success: 3,
  info: 4,
  debug: 5,
};

function resolveLogLevel(): LogLevel {
  if (process.env.NDEPLOY_DEBUG === "1" || process.env.NDEPLOY_DEBUG === "true") {
    return "debug";
  }

  const rawLevel = process.env.NDEPLOY_LOG_LEVEL?.toLowerCase();
  if (rawLevel && rawLevel in LOG_LEVELS) {
    return rawLevel as LogLevel;
  }

  return "success";
}

const activeLogLevel = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[activeLogLevel] >= LOG_LEVELS[level];
}

export const logger = {
  info: (msg: string): void => {
    if (shouldLog("info")) {
      console.log(chalk.cyan(msg));
    }
  },
  success: (msg: string): void => {
    if (shouldLog("success")) {
      console.log(chalk.green(msg));
    }
  },
  warn: (msg: string): void => {
    if (shouldLog("warn")) {
      console.warn(chalk.yellow(msg));
    }
  },
  error: (msg: string): void => {
    if (shouldLog("error")) {
      console.error(chalk.red(msg));
    }
  },
  debug: (msg: string): void => {
    if (shouldLog("debug")) {
      console.log(chalk.gray(msg));
    }
  },
};
