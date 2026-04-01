const request = require('supertest');
const { buildApp } = require('../server');

describe('Healthchecks', () => {
  test('GET /health retourne 200', async () => {
    const app = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('GET /api/health retourne 200 (derrière Nginx)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});
