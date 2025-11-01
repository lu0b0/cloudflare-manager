import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import {
  initMasterPassword,
  verifyMasterPassword,
  isMasterPasswordSet,
  generateToken,
} from '../middleware/auth.js';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  // 检查主密码是否已设置
  router.get('/status', (req: Request, res: Response) => {
    const isSet = isMasterPasswordSet(db);
    res.json({ passwordSet: isSet });
  });

  // 设置主密码（首次初始化）
  router.post('/init', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;

      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      if (isMasterPasswordSet(db)) {
        return res.status(400).json({ error: 'Master password already set' });
      }

      await initMasterPassword(db, password);
      const token = generateToken();

      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 登录
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }

      const isValid = await verifyMasterPassword(db, password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      const token = generateToken();
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
