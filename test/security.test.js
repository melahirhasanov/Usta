const test = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_SECRET ||= "t".repeat(40);
const { stripOperators, rateLimit } = require("../middleware/security");
const { checkEmail, checkPassword, checkCoords } = require("../middleware/validate");
const { belongsToRoom, otherSide, parseRoom } = require("../socket");
const { checkLogin } = require("../services/login");

const ID = "a".repeat(24);
const customer = { role: "customer", chatId: "a@b.co" };

test("Mongo operatorları təmizlənir", () => {
  assert.deepEqual(stripOperators({ email: { $ne: null }, "a.b": 1, ok: [{ $gt: 1, x: 2 }] }), { email: {}, ok: [{ x: 2 }] });
});

test("limit URL-in hərfləri və sonundakı / ilə aşılmır", () => {
  const limit = rateLimit({ windowMs: 1000, max: 2 });
  let blocked = 0;
  const res = { set() {}, status: () => ({ json: () => blocked++ }) };
  for (const path of ["/login", "/LOGIN", "/Login/", "/lOgin"]) limit({ ip: "1", baseUrl: "/api/auth", path }, res, () => {});
  assert.equal(blocked, 2);
});

test("söhbətə yalnız dəqiq iştirakçı daxil olur", () => {
  assert.ok(belongsToRoom(`a@b.co_${ID}`, customer));
  assert.ok(belongsToRoom(`x_y@b.co_${ID}`, { role: "customer", chatId: "x_y@b.co" }));
  assert.ok(!belongsToRoom(`a@b.co_x_${ID}`, customer), "prefiks");
  assert.ok(!belongsToRoom(`z@b.co_${ID}`, customer));
  assert.ok(!belongsToRoom(`a@b.co_${ID}`, { role: "master", chatId: "a@b.co" }), "rol");
  assert.ok(!belongsToRoom(`a@b.co_${"b".repeat(24)}`, { role: "master", chatId: ID }));
  assert.equal(otherSide(`a@b.co_${ID}`, customer), ID);
  for (const bad of [null, 5, {}, [], "x", "_"]) assert.equal(parseRoom(bad), null);
});

test("giriş məlumatı yoxlamaları", () => {
  assert.ok(checkPassword("1234567"));
  assert.ok(checkPassword("a".repeat(73)));
  assert.equal(checkPassword("12345678"), null);
  assert.ok(checkEmail("a@b.co_x"));
  assert.ok(checkEmail({ $ne: 1 }));
  assert.ok(checkCoords("x", 1));
});

test("hesab yoxdursa da şifrə yoxlanılır və rədd edilir", async () => {
  assert.equal(await checkLogin(null, "hesab-yoxdur"), false);
});
