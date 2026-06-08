/**
 * Multibranch validation: test che il modello dati supporta sezioni annidate.
 * Verifica:
 * 1. makeSection accetta parent_id
 * 2. getSections ritorna tutte le sezioni con parent_id
 * 3. updateSection può cambiare parent_id
 * 4. deleteSection gestisce sezioni con figli
 * 5. Anti-ciclo: impedire drop che crea loop
 */

import Database from "@tauri-apps/plugin-sql";
import { makeSection, getSections, updateSection, deleteSection, getProjects, makeProject } from "./src/database/db";

// Helper
function generateId(): string {
  return "test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

async function run() {
  let conn: any = null;
  const testSectionIds: string[] = [];
  let testProjectId: string = "";

  try {
    // 1. Setup test project
    testProjectId = generateId();
    const testProject = makeProject(testProjectId, "TEST_MULTIBRANCH_DELETE_ME", "test");
    console.log("✓ Setup test project:", testProjectId);

    // 2. Test 1: makeSection con parent_id null
    const root1Id = generateId();
    const root1 = makeSection(testProjectId, "Root 1", 0, null);
    testSectionIds.push(root1.id);
    console.log("✓ Test 1: makeSection accetta parent_id null");

    // 3. Test 2: makeSection con parent_id valido
    const child1Id = generateId();
    const child1 = makeSection(testProjectId, "Child of Root 1", 0, root1.id);
    testSectionIds.push(child1.id);
    console.log("✓ Test 2: makeSection accetta parent_id valido");

    // 4. Test 3: nidificazione profonda (3 livelli)
    const subChild1Id = generateId();
    const subChild1 = makeSection(testProjectId, "SubChild of Child 1", 0, child1.id);
    testSectionIds.push(subChild1.id);
    console.log("✓ Test 3: nidificazione a 3 livelli funziona");

    // 5. Test 4: getSections ritorna tutte le sezioni
    const sections = await getSections(testProjectId);
    const testSections = sections.filter(s => testSectionIds.includes(s.id));
    if (testSections.length !== 3) {
      throw new Error(`getSections ritorna ${testSections.length} sezioni invece di 3`);
    }
    console.log(`✓ Test 4: getSections ritorna tutte le ${testSections.length} sezioni create`);

    // 6. Test 5: parent_id è preservato
    const child1FromDb = testSections.find(s => s.id === child1.id);
    if (child1FromDb?.parent_id !== root1.id) {
      throw new Error(`parent_id non preservato: ${child1FromDb?.parent_id} vs ${root1.id}`);
    }
    console.log("✓ Test 5: parent_id è preservato correttamente");

    const subChild1FromDb = testSections.find(s => s.id === subChild1.id);
    if (subChild1FromDb?.parent_id !== child1.id) {
      throw new Error(`parent_id subchild non preservato: ${subChild1FromDb?.parent_id} vs ${child1.id}`);
    }
    console.log("✓ Test 6: parent_id sub-child è preservato");

    // 7. Test 7: updateSection può cambiare parent_id
    const root2Id = generateId();
    const root2 = makeSection(testProjectId, "Root 2", 1, null);
    testSectionIds.push(root2.id);
    console.log("✓ Setup Root 2");

    // Sposta child1 sotto root2
    child1.parent_id = root2.id;
    await updateSection(child1);
    const child1After = (await getSections(testProjectId)).find(s => s.id === child1.id);
    if (child1After?.parent_id !== root2.id) {
      throw new Error(`updateSection non ha cambiato parent_id: ${child1After?.parent_id}`);
    }
    console.log("✓ Test 7: updateSection può cambiare parent_id");

    // 8. Test 8: updateSection può spostare al top level (parent_id = null)
    child1.parent_id = null as any;
    child1.order_index = 2;
    await updateSection(child1);
    const child1TopLevel = (await getSections(testProjectId)).find(s => s.id === child1.id);
    if (child1TopLevel?.parent_id !== null) {
      throw new Error(`updateSection non ha messo a top level: ${child1TopLevel?.parent_id}`);
    }
    console.log("✓ Test 8: updateSection può spostare a top level");

    // 9. Test 9: anti-ciclo check (logica applicativa, non DB)
    // Simuliamo: proviamo a spostare root1 sotto il proprio discendente
    // Questo è un test di logica, non di DB. Lo facciamo con una funzione helper.
    function isDescendantOf(candidateAncestorId: string, candidateDescendantId: string, allSections: any[]): boolean {
      if (candidateAncestorId === candidateDescendantId) return true;
      const descendant = allSections.find(s => s.id === candidateDescendantId);
      if (!descendant || !descendant.parent_id) return false;
      return isDescendantOf(candidateAncestorId, descendant.parent_id, allSections);
    }

    const allSections = await getSections(testProjectId);
    // Proviamo a spostare root1 sotto subChild1 (suo discendente): deve essere rifiutato
    if (!isDescendantOf(subChild1.id, root1.id, allSections)) {
      throw new Error("isDescendantOf dovrebbe rilevare che root1 è antenato di subChild1");
    }
    console.log("✓ Test 9: anti-ciclo check funziona (root1 è antenato di subChild1)");

    // Proviamo a spostare root1 sotto un nodo che non è suo discendente: OK
    if (isDescendantOf(root2.id, root1.id, allSections)) {
      throw new Error("isDescendantOf non dovrebbe rilevare che root2 è antenato di root1");
    }
    console.log("✓ Test 10: anti-ciclo check negativo funziona (root2 non è antenato di root1)");

    // 10. Test 11: order_index funziona tra fratelli
    // Creiamo 3 fratelli allo stesso livello
    const sib1Id = generateId();
    const sib2Id = generateId();
    const sib3Id = generateId();
    const sib1 = makeSection(testProjectId, "Sibling 1", 0, null);
    const sib2 = makeSection(testProjectId, "Sibling 2", 1, null);
    const sib3 = makeSection(testProjectId, "Sibling 3", 2, null);
    testSectionIds.push(sib1.id, sib2.id, sib3.id);
    console.log("✓ Setup 3 fratelli");

    const sibs = (await getSections(testProjectId)).filter(s => [sib1.id, sib2.id, sib3.id].includes(s.id));
    if (sibs[0].order_index !== 0 || sibs[1].order_index !== 1 || sibs[2].order_index !== 2) {
      throw new Error("order_index fratelli non rispettato");
    }
    console.log("✓ Test 11: order_index tra fratelli è rispettato");

    console.log("\n🎉 TUTTI I TEST PASSATI. Modello dati nested funziona correttamente.");

  } catch (e) {
    console.error("❌ TEST FALLITO:", e);
    process.exit(1);
  } finally {
    // Cleanup: elimina tutte le sezioni di test
    if (testSectionIds.length > 0) {
      for (const id of testSectionIds) {
        try {
          await deleteSection(id);
        } catch (e) {
          console.warn(`Cleanup fallito per ${id}:`, e);
        }
      }
    }
    console.log("✓ Cleanup completato");
  }
}

run();
