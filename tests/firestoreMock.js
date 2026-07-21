// tests/firestoreMock.js
// ── Firestore compat-SDK mock แบบ in-memory รองรับ subcollection ซ้อนกันได้ (patients/{id}/visits/{id})
// ใช้ทดสอบทั้ง migration/migrate.js (top-level เท่านั้น) และตัว adapter ในตัวแอพเอง
// (tests/collections-adapter.test.js) โดยไม่ต้องเชื่อมต่อ Firestore จริงเลย
function makeFirestoreMock(seed = {}) {
  const store = new Map(); // full path (เช่น "patients/p1" หรือ "patients/p1/visits/v1") -> data

  function docRef(path) {
    const segs = path.split('/');
    return {
      id: segs[segs.length - 1],
      path,
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: async (data) => { store.set(path, data); },
      delete: async () => { store.delete(path); },
      collection: (sub) => collectionRef(`${path}/${sub}`),
    };
  }
  function collectionRef(path) {
    return {
      path,
      doc: (id) => docRef(`${path}/${id}`),
      get: async () => {
        const prefix = path + '/';
        const docs = [];
        for (const [p, data] of store.entries()) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          if (rest.includes('/')) continue; // ข้าม doc ที่อยู่ลึกกว่านี้ (subcollection ของ doc อื่น)
          docs.push({ id: rest, data: () => store.get(p), ref: docRef(p) });
        }
        return { docs };
      },
    };
  }

  Object.entries(seed).forEach(([path, data]) => store.set(path, data));

  return {
    collection: (name) => collectionRef(name),
    doc: (path) => docRef(path),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ type: 'set', ref, data }),
        delete: (ref) => ops.push({ type: 'delete', ref }),
        commit: async () => {
          for (const op of ops) {
            if (op.type === 'delete') store.delete(op.ref.path);
            else store.set(op.ref.path, op.data);
          }
        },
      };
    },
    _store: store,
  };
}

module.exports = { makeFirestoreMock };
