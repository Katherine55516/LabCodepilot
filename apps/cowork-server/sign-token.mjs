#!/usr/bin/env node
/**
 * HMAC 用户 token 签发工具(R4)—— dev/运维用;生产由账号后端用同密钥签发下发。
 *
 * 用法:
 *   COWORK_AUTH_SECRET=<密钥> node sign-token.mjs <userId> [ttlSeconds]
 * 输出一行 token,填进客户端设置 cowork_remote_token(R5 由账号登录下发)。
 */
import { signToken } from './lib/authz.mjs';

const uid = process.argv[2];
const ttl = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
if (!uid) { process.stderr.write('usage: COWORK_AUTH_SECRET=<secret> node sign-token.mjs <userId> [ttlSeconds]\n'); process.exit(1); }
if (!process.env.COWORK_AUTH_SECRET) { process.stderr.write('COWORK_AUTH_SECRET env required\n'); process.exit(1); }

try {
  process.stdout.write(signToken(uid, process.env.COWORK_AUTH_SECRET, ttl) + '\n');
} catch (e) {
  process.stderr.write('sign failed: ' + (e?.message || e) + '\n');
  process.exit(1);
}
