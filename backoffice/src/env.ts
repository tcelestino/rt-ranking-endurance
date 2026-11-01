import 'dotenv/config';

// o backoffice sempre loga; os CLIs de processor/ continuam silenciosos (ver processor/logger.ts)
process.env.LOG_LEVEL ??= 'info';
