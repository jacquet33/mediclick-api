/*
 * Vademécum de apoyo para la receta (nombres genéricos / DCI usados en Argentina).
 * Sirve para autocompletar y sugerir presentaciones habituales. No reemplaza al prospecto ni
 * al criterio del profesional: el médico elige y confirma cada dato de la receta.
 *
 * Formato: [genérico, grupo, [formas], [presentaciones habituales]]
 */
(function () {
  const C = 'Comprimidos', CR = 'Comprimidos recubiertos', CA = 'Cápsulas', J = 'Jarabe', S = 'Suspensión oral',
    G = 'Gotas', I = 'Solución inyectable', CRE = 'Crema', GEL = 'Gel', POM = 'Pomada', AER = 'Aerosol para inhalar',
    COL = 'Colirio', SOB = 'Sobres', OV = 'Óvulos', PAR = 'Parches', SPR = 'Spray nasal';
  const M = [
    // Analgésicos, antiinflamatorios
    ['Paracetamol', 'Analgésicos', [C, J, G, S], ['500 mg x 20', '1 g x 10', '160 mg/5 ml x 100 ml']],
    ['Ibuprofeno', 'AINE', [C, CR, CA, S], ['400 mg x 20', '600 mg x 20', '2% x 90 ml', '4% x 90 ml']],
    ['Diclofenac', 'AINE', [C, CR, GEL, I], ['50 mg x 20', '75 mg x 15', '1% gel x 60 g']],
    ['Naproxeno', 'AINE', [C, CR], ['500 mg x 10', '550 mg x 10']],
    ['Ketorolac', 'AINE', [C, I], ['10 mg x 10', '20 mg x 10']],
    ['Meloxicam', 'AINE', [C], ['7,5 mg x 10', '15 mg x 10']],
    ['Ácido acetilsalicílico', 'Antiagregantes', [C], ['100 mg x 30', '500 mg x 20']],
    ['Dipirona', 'Analgésicos', [C, G, I], ['500 mg x 20', '1 g x 10', '500 mg/ml x 20 ml']],
    ['Ibuprofeno + Pseudoefedrina', 'Antigripales', [C], ['400/60 mg x 10']],
    ['Tramadol', 'Opioides', [CA, G, C], ['50 mg x 20', '100 mg/ml x 10 ml']],
    ['Pregabalina', 'Neuropáticos', [CA], ['75 mg x 28', '150 mg x 28']],
    ['Gabapentina', 'Neuropáticos', [CA, C], ['300 mg x 30', '400 mg x 30']],
    ['Ciclobenzaprina', 'Relajantes musculares', [C], ['10 mg x 15']],
    ['Metotrexato', 'Inmunomoduladores', [C, I], ['2,5 mg x 50']],
    ['Hidroxicloroquina', 'Inmunomoduladores', [C], ['200 mg x 30']],
    ['Colchicina', 'Gota', [C], ['1 mg x 20']],
    ['Alopurinol', 'Gota', [C], ['100 mg x 30', '300 mg x 30']],
    ['Prednisona', 'Corticoides', [C, G], ['5 mg x 20', '20 mg x 10', '40 mg x 10']],
    ['Betametasona', 'Corticoides', [C, I, CRE, G], ['0,6 mg x 20', '0,05% crema x 20 g']],
    ['Dexametasona', 'Corticoides', [C, I], ['4 mg x 10', '8 mg/2 ml']],
    ['Metilprednisolona', 'Corticoides', [C, I], ['4 mg x 20', '16 mg x 15']],
    // Antibióticos
    ['Amoxicilina', 'Antibióticos (betalactámicos)', [C, CA, S], ['500 mg x 21', '875 mg x 14', '1 g x 16', '250 mg/5 ml x 90 ml', '500 mg/5 ml x 90 ml']],
    ['Amoxicilina + Ácido clavulánico', 'Antibióticos (betalactámicos)', [C, CR, S], ['875/125 mg x 14', '500/125 mg x 21', '400/57 mg/5 ml x 70 ml']],
    ['Ampicilina', 'Antibióticos (betalactámicos)', [C, CA, S, I], ['500 mg x 16']],
    ['Penicilina G benzatínica', 'Antibióticos (betalactámicos)', [I], ['1.200.000 UI', '2.400.000 UI']],
    ['Fenoximetilpenicilina', 'Antibióticos (betalactámicos)', [C, S], ['1.000.000 UI x 15']],
    ['Cefalexina', 'Antibióticos (cefalosporinas)', [CA, C, S], ['500 mg x 16', '1 g x 8', '250 mg/5 ml x 90 ml']],
    ['Cefuroxima', 'Antibióticos (cefalosporinas)', [C], ['500 mg x 14']],
    ['Cefixima', 'Antibióticos (cefalosporinas)', [C, S], ['400 mg x 7']],
    ['Ceftriaxona', 'Antibióticos (cefalosporinas)', [I], ['1 g']],
    ['Azitromicina', 'Antibióticos (macrólidos)', [C, S], ['500 mg x 3', '200 mg/5 ml x 15 ml']],
    ['Claritromicina', 'Antibióticos (macrólidos)', [C, S], ['500 mg x 14', '250 mg/5 ml x 60 ml']],
    ['Eritromicina', 'Antibióticos (macrólidos)', [C, S], ['500 mg x 16']],
    ['Ciprofloxacina', 'Antibióticos (quinolonas)', [C, COL], ['500 mg x 14', '0,3% colirio x 5 ml']],
    ['Levofloxacina', 'Antibióticos (quinolonas)', [C], ['500 mg x 7', '750 mg x 7']],
    ['Trimetoprima + Sulfametoxazol', 'Antibióticos (sulfonamidas)', [C, S], ['160/800 mg x 20', '40/200 mg/5 ml x 100 ml']],
    ['Nitrofurantoína', 'Antibióticos (urinarios)', [CA, C], ['100 mg x 28']],
    ['Fosfomicina', 'Antibióticos (urinarios)', [SOB], ['3 g x 1']],
    ['Doxiciclina', 'Antibióticos (tetraciclinas)', [C, CA], ['100 mg x 14']],
    ['Clindamicina', 'Antibióticos', [CA, I, GEL], ['300 mg x 16', '1% gel x 30 g']],
    ['Metronidazol', 'Antibióticos / antiparasitarios', [C, S, OV, GEL], ['500 mg x 14', '500 mg óvulos x 10']],
    ['Mupirocina', 'Antibióticos tópicos', [POM, CRE], ['2% x 15 g']],
    ['Ácido fusídico', 'Antibióticos tópicos', [CRE], ['2% x 15 g']],
    // Antivirales, antifúngicos, antiparasitarios
    ['Aciclovir', 'Antivirales', [C, CRE], ['400 mg x 35', '800 mg x 35', '5% crema x 5 g']],
    ['Valaciclovir', 'Antivirales', [C], ['500 mg x 10', '1 g x 21']],
    ['Oseltamivir', 'Antivirales', [CA], ['75 mg x 10']],
    ['Fluconazol', 'Antifúngicos', [CA], ['150 mg x 1', '150 mg x 2', '200 mg x 7']],
    ['Clotrimazol', 'Antifúngicos', [CRE, OV], ['1% crema x 20 g', '500 mg óvulo x 1']],
    ['Terbinafina', 'Antifúngicos', [C, CRE], ['250 mg x 14', '1% crema x 15 g']],
    ['Nistatina', 'Antifúngicos', [S, CRE], ['100.000 UI/ml x 30 ml']],
    ['Ivermectina', 'Antiparasitarios', [C, G], ['6 mg x 2']],
    ['Mebendazol', 'Antiparasitarios', [C, S], ['100 mg x 6', '200 mg x 6']],
    ['Albendazol', 'Antiparasitarios', [C, S], ['400 mg x 1']],
    ['Permetrina', 'Antiparasitarios tópicos', [CRE], ['5% crema x 60 g', '1% loción x 60 ml']],
    // Cardiovascular
    ['Enalapril', 'Antihipertensivos (IECA)', [C], ['5 mg x 30', '10 mg x 30', '20 mg x 30']],
    ['Lisinopril', 'Antihipertensivos (IECA)', [C], ['5 mg x 30', '10 mg x 30', '20 mg x 30']],
    ['Ramipril', 'Antihipertensivos (IECA)', [C, CA], ['2,5 mg x 30', '5 mg x 30', '10 mg x 30']],
    ['Losartán', 'Antihipertensivos (ARA II)', [C], ['50 mg x 30', '100 mg x 30']],
    ['Valsartán', 'Antihipertensivos (ARA II)', [C], ['80 mg x 28', '160 mg x 28']],
    ['Telmisartán', 'Antihipertensivos (ARA II)', [C], ['40 mg x 28', '80 mg x 28']],
    ['Amlodipina', 'Antihipertensivos (bloq. cálcicos)', [C], ['5 mg x 30', '10 mg x 30']],
    ['Atenolol', 'Betabloqueantes', [C], ['25 mg x 30', '50 mg x 30']],
    ['Bisoprolol', 'Betabloqueantes', [C], ['2,5 mg x 30', '5 mg x 30']],
    ['Carvedilol', 'Betabloqueantes', [C], ['6,25 mg x 30', '12,5 mg x 30', '25 mg x 30']],
    ['Nebivolol', 'Betabloqueantes', [C], ['5 mg x 30']],
    ['Propranolol', 'Betabloqueantes', [C], ['10 mg x 50', '40 mg x 50']],
    ['Hidroclorotiazida', 'Diuréticos', [C], ['25 mg x 30', '50 mg x 30']],
    ['Clortalidona', 'Diuréticos', [C], ['25 mg x 30']],
    ['Indapamida', 'Diuréticos', [C], ['1,5 mg x 30']],
    ['Furosemida', 'Diuréticos', [C, I], ['40 mg x 30']],
    ['Espironolactona', 'Diuréticos (ahorradores de potasio)', [C], ['25 mg x 30', '100 mg x 30']],
    ['Atorvastatina', 'Hipolipemiantes (estatinas)', [C], ['10 mg x 30', '20 mg x 30', '40 mg x 30', '80 mg x 30']],
    ['Rosuvastatina', 'Hipolipemiantes (estatinas)', [C], ['5 mg x 30', '10 mg x 30', '20 mg x 30']],
    ['Simvastatina', 'Hipolipemiantes (estatinas)', [C], ['20 mg x 30', '40 mg x 30']],
    ['Ezetimibe', 'Hipolipemiantes', [C], ['10 mg x 30']],
    ['Fenofibrato', 'Hipolipemiantes', [CA, C], ['200 mg x 30']],
    ['Clopidogrel', 'Antiagregantes', [C], ['75 mg x 28']],
    ['Warfarina', 'Anticoagulantes', [C], ['5 mg x 30']],
    ['Acenocumarol', 'Anticoagulantes', [C], ['4 mg x 20', '1 mg x 20']],
    ['Apixabán', 'Anticoagulantes', [C], ['2,5 mg x 60', '5 mg x 60']],
    ['Rivaroxabán', 'Anticoagulantes', [C], ['10 mg x 10', '15 mg x 28', '20 mg x 28']],
    ['Digoxina', 'Cardiotónicos', [C], ['0,25 mg x 30']],
    ['Amiodarona', 'Antiarrítmicos', [C], ['200 mg x 30']],
    ['Isosorbide mononitrato', 'Nitratos', [C], ['20 mg x 30', '40 mg x 30']],
    ['Isosorbide dinitrato', 'Nitratos', [C], ['5 mg sublingual x 20', '10 mg x 30']],
    // Metabolismo / endocrino
    ['Metformina', 'Antidiabéticos', [C], ['500 mg x 30', '850 mg x 60', '1000 mg x 60']],
    ['Glibenclamida', 'Antidiabéticos (sulfonilureas)', [C], ['5 mg x 50']],
    ['Gliclazida', 'Antidiabéticos (sulfonilureas)', [C], ['30 mg x 30', '60 mg x 30']],
    ['Sitagliptina', 'Antidiabéticos (iDPP4)', [C], ['100 mg x 28']],
    ['Vildagliptina', 'Antidiabéticos (iDPP4)', [C], ['50 mg x 56']],
    ['Empagliflozina', 'Antidiabéticos (iSGLT2)', [C], ['10 mg x 30', '25 mg x 30']],
    ['Dapagliflozina', 'Antidiabéticos (iSGLT2)', [C], ['10 mg x 30']],
    ['Insulina glargina', 'Insulinas', [I], ['100 UI/ml lapicera x 3 ml']],
    ['Insulina NPH', 'Insulinas', [I], ['100 UI/ml x 10 ml']],
    ['Levotiroxina', 'Tiroides', [C], ['25 mcg x 50', '50 mcg x 50', '75 mcg x 50', '100 mcg x 50']],
    ['Metimazol', 'Tiroides', [C], ['5 mg x 30', '20 mg x 30']],
    ['Vitamina D3 (colecalciferol)', 'Vitaminas', [G, C, CA], ['100.000 UI', '2.000 UI x 30']],
    ['Calcio + Vitamina D', 'Vitaminas y minerales', [C], ['600 mg/400 UI x 30']],
    ['Hierro (sulfato ferroso)', 'Antianémicos', [C, G], ['200 mg x 30']],
    ['Ácido fólico', 'Vitaminas', [C], ['1 mg x 30', '5 mg x 30']],
    ['Vitamina B12 (cianocobalamina)', 'Vitaminas', [I, C], ['1000 mcg x 5']],
    ['Alendronato', 'Osteoporosis', [C], ['70 mg x 4']],
    // Digestivo
    ['Omeprazol', 'Protectores gástricos (IBP)', [CA], ['20 mg x 14', '20 mg x 28', '40 mg x 14']],
    ['Pantoprazol', 'Protectores gástricos (IBP)', [C], ['20 mg x 28', '40 mg x 28']],
    ['Esomeprazol', 'Protectores gástricos (IBP)', [C, CA], ['20 mg x 28', '40 mg x 14']],
    ['Lansoprazol', 'Protectores gástricos (IBP)', [CA], ['30 mg x 14']],
    ['Ranitidina', 'Protectores gástricos (anti-H2)', [C], ['150 mg x 20']],
    ['Famotidina', 'Protectores gástricos (anti-H2)', [C], ['20 mg x 20', '40 mg x 20']],
    ['Sucralfato', 'Protectores gástricos', [C, S], ['1 g x 40']],
    ['Domperidona', 'Antieméticos / procinéticos', [C, G, S], ['10 mg x 20']],
    ['Metoclopramida', 'Antieméticos / procinéticos', [C, G, I], ['10 mg x 20']],
    ['Ondansetrón', 'Antieméticos', [C, I], ['4 mg x 10', '8 mg x 10']],
    ['Trimebutina', 'Antiespasmódicos', [C, S], ['200 mg x 30']],
    ['Butilhioscina', 'Antiespasmódicos', [C, G, I], ['10 mg x 20']],
    ['Loperamida', 'Antidiarreicos', [C, CA], ['2 mg x 12']],
    ['Sales de rehidratación oral', 'Hidratación', [SOB], ['x 10 sobres']],
    ['Lactulosa', 'Laxantes', [J, S], ['65% x 200 ml']],
    ['Polietilenglicol', 'Laxantes', [SOB], ['17 g x 14']],
    ['Bisacodilo', 'Laxantes', [C], ['5 mg x 20']],
    ['Simeticona', 'Antiflatulentos', [C, G], ['80 mg x 30']],
    ['Mesalazina', 'Enfermedad inflamatoria intestinal', [C], ['500 mg x 50', '1 g x 60']],
    // Respiratorio / alergia
    ['Salbutamol', 'Broncodilatadores', [AER, J], ['100 mcg/dosis x 200 dosis']],
    ['Budesonida', 'Corticoides inhalados', [AER, SPR], ['200 mcg/dosis x 200 dosis', '64 mcg/dosis spray nasal']],
    ['Fluticasona', 'Corticoides inhalados', [AER, SPR], ['125 mcg/dosis x 120 dosis', '50 mcg spray nasal x 120']],
    ['Budesonida + Formoterol', 'Broncodilatadores + corticoide', [AER], ['160/4,5 mcg x 120 dosis']],
    ['Salmeterol + Fluticasona', 'Broncodilatadores + corticoide', [AER], ['25/125 mcg x 120 dosis', '50/250 mcg x 60 dosis']],
    ['Tiotropio', 'Broncodilatadores', [AER], ['2,5 mcg x 60 dosis']],
    ['Montelukast', 'Antiasmáticos', [C], ['10 mg x 30', '5 mg masticable x 30', '4 mg sobres x 30']],
    ['Loratadina', 'Antihistamínicos', [C, J], ['10 mg x 10', '10 mg x 30', '5 mg/5 ml x 60 ml']],
    ['Desloratadina', 'Antihistamínicos', [C, J], ['5 mg x 10', '5 mg x 30']],
    ['Cetirizina', 'Antihistamínicos', [C, G, J], ['10 mg x 10']],
    ['Levocetirizina', 'Antihistamínicos', [C, G], ['5 mg x 20']],
    ['Fexofenadina', 'Antihistamínicos', [C], ['120 mg x 10', '180 mg x 10']],
    ['Difenhidramina', 'Antihistamínicos', [J, I, C], ['12,5 mg/5 ml x 120 ml']],
    ['Mometasona', 'Corticoides tópicos / nasales', [SPR, CRE], ['50 mcg spray nasal x 140', '0,1% crema x 15 g']],
    ['Dextrometorfano', 'Antitusivos', [J], ['15 mg/5 ml x 120 ml']],
    ['Ambroxol', 'Mucolíticos', [J, C, G], ['30 mg/5 ml x 120 ml']],
    ['N-acetilcisteína', 'Mucolíticos', [SOB, C], ['600 mg x 20']],
    ['Cloruro de sodio 0,9% (solución fisiológica)', 'Higiene nasal', [SPR, G], ['x 30 ml']],
    // Psiquiatría / neurología
    ['Sertralina', 'Antidepresivos (ISRS)', [C], ['50 mg x 30', '100 mg x 30']],
    ['Escitalopram', 'Antidepresivos (ISRS)', [C], ['10 mg x 30', '20 mg x 30']],
    ['Fluoxetina', 'Antidepresivos (ISRS)', [C, CA], ['20 mg x 30']],
    ['Paroxetina', 'Antidepresivos (ISRS)', [C], ['20 mg x 30']],
    ['Citalopram', 'Antidepresivos (ISRS)', [C], ['20 mg x 30']],
    ['Venlafaxina', 'Antidepresivos (IRSN)', [C, CA], ['75 mg x 30', '150 mg x 30']],
    ['Duloxetina', 'Antidepresivos (IRSN)', [CA], ['30 mg x 30', '60 mg x 30']],
    ['Bupropión', 'Antidepresivos', [C], ['150 mg x 30']],
    ['Mirtazapina', 'Antidepresivos', [C], ['15 mg x 30', '30 mg x 30']],
    ['Trazodona', 'Antidepresivos', [C], ['50 mg x 30', '100 mg x 30']],
    ['Amitriptilina', 'Antidepresivos (tricíclicos)', [C], ['25 mg x 30']],
    ['Clonazepam', 'Benzodiazepinas', [C, G], ['0,5 mg x 30', '2 mg x 30', '2,5 mg/ml x 20 ml']],
    ['Alprazolam', 'Benzodiazepinas', [C], ['0,5 mg x 30', '1 mg x 30']],
    ['Lorazepam', 'Benzodiazepinas', [C], ['1 mg x 30', '2,5 mg x 30']],
    ['Diazepam', 'Benzodiazepinas', [C, I], ['5 mg x 30', '10 mg x 30']],
    ['Zolpidem', 'Hipnóticos', [C], ['10 mg x 30']],
    ['Quetiapina', 'Antipsicóticos', [C], ['25 mg x 30', '100 mg x 30']],
    ['Risperidona', 'Antipsicóticos', [C, G], ['1 mg x 30', '2 mg x 30']],
    ['Olanzapina', 'Antipsicóticos', [C], ['5 mg x 30', '10 mg x 30']],
    ['Haloperidol', 'Antipsicóticos', [C, G, I], ['5 mg x 30']],
    ['Litio (carbonato)', 'Estabilizadores del ánimo', [C], ['300 mg x 50']],
    ['Ácido valproico', 'Anticonvulsivantes', [C, CA, J], ['250 mg x 30', '500 mg x 30']],
    ['Lamotrigina', 'Anticonvulsivantes', [C], ['25 mg x 30', '100 mg x 30']],
    ['Levetiracetam', 'Anticonvulsivantes', [C, S], ['500 mg x 30', '1000 mg x 30']],
    ['Carbamazepina', 'Anticonvulsivantes', [C], ['200 mg x 30', '400 mg x 30']],
    ['Topiramato', 'Anticonvulsivantes', [C], ['25 mg x 30', '50 mg x 30']],
    ['Sumatriptán', 'Antimigrañosos', [C], ['50 mg x 2', '100 mg x 2']],
    ['Metilfenidato', 'Psicoestimulantes', [C], ['10 mg x 30']],
    ['Donepecilo', 'Antidemencia', [C], ['5 mg x 28', '10 mg x 28']],
    ['Levodopa + Carbidopa', 'Antiparkinsonianos', [C], ['250/25 mg x 30']],
    ['Betahistina', 'Antivertiginosos', [C], ['16 mg x 30', '24 mg x 30']],
    ['Flunarizina', 'Antivertiginosos', [C, G], ['10 mg x 30']],
    // Urología / ginecología
    ['Tamsulosina', 'Urología', [CA], ['0,4 mg x 30']],
    ['Finasteride', 'Urología', [C], ['5 mg x 30', '1 mg x 30']],
    ['Sildenafil', 'Disfunción eréctil', [C], ['50 mg x 4', '100 mg x 4']],
    ['Tadalafil', 'Disfunción eréctil', [C], ['5 mg x 30', '20 mg x 4']],
    ['Oxibutinina', 'Urología', [C], ['5 mg x 30']],
    ['Levonorgestrel + Etinilestradiol', 'Anticonceptivos', [C], ['0,15/0,03 mg x 21', '0,15/0,03 mg x 28']],
    ['Drospirenona + Etinilestradiol', 'Anticonceptivos', [C], ['3/0,02 mg x 24+4', '3/0,03 mg x 21']],
    ['Desogestrel', 'Anticonceptivos', [C], ['0,075 mg x 28']],
    ['Levonorgestrel', 'Anticoncepción de emergencia', [C], ['1,5 mg x 1']],
    ['Progesterona', 'Hormonas', [CA, OV], ['100 mg x 30', '200 mg x 30']],
    ['Estradiol', 'Hormonas', [C, GEL, PAR], ['1 mg x 28', '0,06% gel']],
    ['Misoprostol', 'Gineco-obstetricia', [C], ['200 mcg']],
    // Dermatología / oftalmología
    ['Hidrocortisona', 'Corticoides tópicos', [CRE], ['1% x 15 g']],
    ['Clobetasol', 'Corticoides tópicos', [CRE, POM], ['0,05% x 30 g']],
    ['Isotretinoína', 'Dermatología', [CA], ['10 mg x 30', '20 mg x 30']],
    ['Adapaleno', 'Dermatología', [GEL], ['0,1% x 30 g']],
    ['Peróxido de benzoilo', 'Dermatología', [GEL], ['5% x 60 g']],
    ['Tobramicina', 'Oftalmológicos', [COL], ['0,3% x 5 ml']],
    ['Tobramicina + Dexametasona', 'Oftalmológicos', [COL], ['0,3/0,1% x 5 ml']],
    ['Lágrimas artificiales (hipromelosa)', 'Oftalmológicos', [COL], ['x 15 ml']],
    ['Timolol', 'Oftalmológicos (glaucoma)', [COL], ['0,5% x 5 ml']],
    ['Latanoprost', 'Oftalmológicos (glaucoma)', [COL], ['0,005% x 2,5 ml']],
  ];

  const FRECUENCIAS = ['Cada 4 horas', 'Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Cada 24 horas', 'Una vez por día, a la mañana', 'Una vez por día, a la noche', 'Dos veces por día', 'Tres veces por día', 'Una vez por semana', 'Dosis única', 'Si hay dolor o fiebre (máx. 3 por día)', 'Según indicación'];
  const DURACIONES = ['1 día', '3 días', '5 días', '7 días', '10 días', '14 días', '21 días', '30 días', '3 meses', 'Tratamiento crónico'];

  // Alergias: si el paciente es alérgico a algo de la clave, alertar con estos genéricos o grupos
  const ALERGIAS = [
    { claves: ['penicilin', 'betalactam', 'amoxi', 'ampicil'], grupos: ['Antibióticos (betalactámicos)'], cruzada: ['Antibióticos (cefalosporinas)'], texto: 'alergia a penicilinas / betalactámicos' },
    { claves: ['cefalospor', 'cefalex', 'ceftri', 'cefurox', 'cefix'], grupos: ['Antibióticos (cefalosporinas)'], texto: 'alergia a cefalosporinas' },
    { claves: ['sulfa', 'sulfonam', 'cotrimox', 'bactrim'], genericos: ['Trimetoprima + Sulfametoxazol'], texto: 'alergia a sulfonamidas' },
    { claves: ['aine', 'aspirina', 'ácido acetilsalic', 'acido acetilsalic', 'ibuprofen', 'diclofen', 'naproxen', 'ketorol', 'meloxic', 'antiinflamatorio'], grupos: ['AINE'], genericos: ['Ácido acetilsalicílico', 'Ibuprofeno + Pseudoefedrina'], texto: 'alergia / intolerancia a AINE' },
    { claves: ['dipiron', 'metamizol'], genericos: ['Dipirona'], texto: 'alergia a dipirona' },
    { claves: ['macrólid', 'macrolid', 'azitro', 'claritro', 'eritro'], grupos: ['Antibióticos (macrólidos)'], texto: 'alergia a macrólidos' },
    { claves: ['quinolon', 'ciproflox', 'levoflox'], grupos: ['Antibióticos (quinolonas)'], texto: 'alergia a quinolonas' },
    { claves: ['iodo', 'yodo'], genericos: ['Amiodarona'], texto: 'alergia al yodo (la amiodarona contiene yodo)' },
  ];

  // Interacciones clínicamente relevantes y bien establecidas (pares de genéricos o grupos).
  // nivel: 'alta' (evitar salvo indicación precisa) | 'moderada' (vigilar / ajustar)
  const GR = (x) => ({ grupo: x }), D = (x) => ({ gen: x });
  const ANTICOAG = [D('Warfarina'), D('Acenocumarol'), D('Apixabán'), D('Rivaroxabán')];
  const INTERACCIONES = [
    { a: ANTICOAG, b: [GR('AINE'), D('Ácido acetilsalicílico'), D('Clopidogrel')], nivel: 'alta', texto: 'Mayor riesgo de sangrado (anticoagulante + AINE/antiagregante).' },
    { a: [D('Warfarina'), D('Acenocumarol')], b: [D('Amiodarona'), D('Fluconazol'), D('Metronidazol'), D('Trimetoprima + Sulfametoxazol'), D('Claritromicina'), D('Ciprofloxacina'), D('Levofloxacina')], nivel: 'alta', texto: 'Potencia el efecto anticoagulante: controlar RIN de cerca.' },
    { a: [GR('Antihipertensivos (IECA)'), GR('Antihipertensivos (ARA II)')], b: [D('Espironolactona')], nivel: 'moderada', texto: 'Riesgo de hiperpotasemia: controlar potasio y función renal.' },
    { a: [GR('Antihipertensivos (IECA)')], b: [GR('Antihipertensivos (ARA II)')], nivel: 'alta', texto: 'Doble bloqueo del sistema renina-angiotensina: más hiperpotasemia e insuficiencia renal.' },
    { a: [GR('Antihipertensivos (IECA)'), GR('Antihipertensivos (ARA II)'), GR('Diuréticos')], b: [GR('AINE')], nivel: 'moderada', texto: 'Los AINE reducen el efecto antihipertensivo y pueden deteriorar la función renal.' },
    { a: [D('Litio (carbonato)')], b: [GR('AINE'), GR('Diuréticos'), GR('Antihipertensivos (IECA)'), GR('Antihipertensivos (ARA II)')], nivel: 'alta', texto: 'Aumenta la litemia (riesgo de toxicidad por litio).' },
    { a: [D('Sildenafil'), D('Tadalafil')], b: [GR('Nitratos')], nivel: 'alta', texto: 'Contraindicado: hipotensión grave (inhibidor de PDE5 + nitratos).' },
    { a: [GR('Antidepresivos (ISRS)'), GR('Antidepresivos (IRSN)')], b: [D('Tramadol'), D('Sumatriptán'), D('Trazodona'), D('Litio (carbonato)')], nivel: 'moderada', texto: 'Riesgo de síndrome serotoninérgico.' },
    { a: [GR('Antidepresivos (ISRS)'), GR('Antidepresivos (IRSN)')], b: [GR('AINE'), D('Ácido acetilsalicílico')].concat(ANTICOAG), nivel: 'moderada', texto: 'Mayor riesgo de sangrado digestivo.' },
    { a: [GR('Benzodiazepinas'), D('Zolpidem')], b: [GR('Opioides'), D('Pregabalina'), D('Gabapentina')], nivel: 'alta', texto: 'Depresión respiratoria y sedación excesiva (benzodiazepina/hipnótico + opioide o gabapentinoide).' },
    { a: [D('Simvastatina'), D('Atorvastatina')], b: [D('Claritromicina'), D('Eritromicina')], nivel: 'alta', texto: 'Aumenta la estatina en sangre: riesgo de miopatía/rabdomiólisis.' },
    { a: [D('Simvastatina')], b: [D('Amiodarona')], nivel: 'moderada', texto: 'Riesgo de miopatía: no superar 20 mg de simvastatina.' },
    { a: [D('Clopidogrel')], b: [D('Omeprazol'), D('Esomeprazol')], nivel: 'moderada', texto: 'Omeprazol/esomeprazol reducen el efecto del clopidogrel; preferir pantoprazol.' },
    { a: [D('Metotrexato')], b: [GR('AINE'), D('Trimetoprima + Sulfametoxazol')], nivel: 'alta', texto: 'Aumenta la toxicidad del metotrexato.' },
    { a: [D('Digoxina')], b: [D('Amiodarona'), D('Claritromicina')], nivel: 'moderada', texto: 'Aumenta la digoxinemia: controlar niveles y frecuencia cardíaca.' },
    { a: [D('Levotiroxina')], b: [D('Calcio + Vitamina D'), D('Hierro (sulfato ferroso)'), D('Sucralfato')], nivel: 'moderada', texto: 'Disminuye la absorción de levotiroxina: separar las tomas al menos 4 horas.' },
    { a: [GR('Antibióticos (quinolonas)'), GR('Antibióticos (tetraciclinas)')], b: [D('Calcio + Vitamina D'), D('Hierro (sulfato ferroso)'), D('Sucralfato')], nivel: 'moderada', texto: 'Disminuye la absorción del antibiótico: separar las tomas.' },
    { a: [D('Amiodarona'), D('Haloperidol'), D('Citalopram'), D('Escitalopram')], b: [GR('Antibióticos (macrólidos)'), GR('Antibióticos (quinolonas)'), D('Ondansetrón'), D('Domperidona')], nivel: 'moderada', texto: 'Prolongación del QT: riesgo de arritmias.' },
    { a: [D('Metronidazol')], b: [D('Litio (carbonato)')], nivel: 'moderada', texto: 'Puede aumentar la litemia.' },
    { a: [D('Carbamazepina')], b: [GR('Anticonceptivos')], nivel: 'alta', texto: 'Reduce la eficacia del anticonceptivo hormonal.' },
    { a: [D('Ácido valproico')], b: [D('Lamotrigina')], nivel: 'moderada', texto: 'El valproato duplica los niveles de lamotrigina (riesgo de rash grave): ajustar dosis.' },
    { a: [GR('Betabloqueantes')], b: [D('Amiodarona'), D('Digoxina')], nivel: 'moderada', texto: 'Bradicardia y bloqueo AV.' },
    { a: [GR('Antidiabéticos (sulfonilureas)')], b: [D('Trimetoprima + Sulfametoxazol'), D('Fluconazol'), D('Claritromicina')], nivel: 'moderada', texto: 'Riesgo de hipoglucemia.' },
    { a: [D('Isotretinoína')], b: [GR('Antibióticos (tetraciclinas)')], nivel: 'alta', texto: 'Contraindicado: hipertensión endocraneana.' },
    { a: [D('Metoclopramida')], b: [GR('Antipsicóticos'), D('Levodopa + Carbidopa')], nivel: 'moderada', texto: 'Más efectos extrapiramidales / antagoniza la levodopa.' },
    { a: [GR('Opioides')], b: [GR('Antipsicóticos'), D('Difenhidramina')], nivel: 'moderada', texto: 'Sedación aditiva.' },
  ];

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const porNombre = new Map(M.map((m) => [norm(m[0]), m]));
  function buscar(q, n) {
    const t = norm(q).trim(); if (t.length < 2) return [];
    const empieza = [], contiene = [];
    for (const m of M) { const k = norm(m[0]); if (k.startsWith(t)) empieza.push(m); else if (k.includes(t) || norm(m[1]).includes(t)) contiene.push(m); }
    return empieza.concat(contiene).slice(0, n || 8);
  }
  function grupoDe(gen) { const m = porNombre.get(norm(gen)); return m ? m[1] : ''; }
  // ¿El genérico (texto libre) coincide con el criterio? Acepta combinaciones ("Amoxicilina + Ácido clavulánico" contiene amoxicilina)
  function coincide(gen, crit) {
    const g = norm(gen); if (!g) return false;
    if (crit.gen) { const c = norm(crit.gen); return g === c || g.split(/\s*\+\s*/).includes(c) || c.split(/\s*\+\s*/).every((x) => g.includes(x)); }
    if (crit.grupo) { const gr = grupoDe(gen); if (gr === crit.grupo) return true; return g.split(/\s*\+\s*/).some((p) => grupoDe(p) === crit.grupo); }
    return false;
  }

  /** Alertas para una receta: items (genéricos), medicación actual y alergias del paciente */
  function revisar(items, actuales, alergias) {
    const out = [];
    const nuevos = items.map((x) => (x || '').trim()).filter(Boolean);
    const todos = nuevos.map((g) => ({ g, nuevo: true })).concat((actuales || []).map((g) => ({ g: String(g).trim(), nuevo: false })).filter((x) => x.g));
    const alg = (alergias || []).map(norm).filter(Boolean);
    // Alergias
    for (const g of nuevos) {
      for (const a of alg) {
        if (norm(g).includes(a) || a.includes(norm(g))) { out.push({ nivel: 'alta', tipo: 'alergia', texto: `${g}: el paciente tiene registrada alergia a "${a}".` }); continue; }
        for (const r of ALERGIAS) {
          if (!r.claves.some((k) => a.includes(norm(k)))) continue;
          const gr = grupoDe(g) || g.split(/\s*\+\s*/).map(grupoDe).find(Boolean) || '';
          if ((r.grupos || []).includes(gr) || (r.genericos || []).some((x) => norm(x) === norm(g)))
            out.push({ nivel: 'alta', tipo: 'alergia', texto: `${g}: ${r.texto} registrada en la ficha.` });
          else if ((r.cruzada || []).includes(gr))
            out.push({ nivel: 'moderada', tipo: 'alergia', texto: `${g}: posible reacción cruzada (${r.texto}).` });
        }
      }
    }
    // Interacciones (al menos uno de los dos es un medicamento nuevo de esta receta)
    const vistos = new Set();
    for (let i = 0; i < todos.length; i++) for (let j = 0; j < todos.length; j++) {
      if (i === j || (!todos[i].nuevo && !todos[j].nuevo)) continue;
      const x = todos[i], y = todos[j];
      if (norm(x.g) === norm(y.g)) continue;
      for (const r of INTERACCIONES) {
        if (r.a.some((c) => coincide(x.g, c)) && r.b.some((c) => coincide(y.g, c))) {
          const k = [norm(x.g), norm(y.g)].sort().join('|') + r.texto; if (vistos.has(k)) continue; vistos.add(k);
          out.push({ nivel: r.nivel, tipo: 'interaccion', texto: `${x.g} + ${y.g}${!x.nuevo || !y.nuevo ? ' (medicación actual)' : ''}: ${r.texto}` });
        }
      }
    }
    // Duplicados terapéuticos dentro de la receta
    const porGrupo = {};
    for (const g of nuevos) { const gr = grupoDe(g); if (gr) (porGrupo[gr] = porGrupo[gr] || []).push(g); }
    for (const [gr, l] of Object.entries(porGrupo)) if (new Set(l.map(norm)).size > 1) out.push({ nivel: 'moderada', tipo: 'duplicado', texto: `Duplicación terapéutica (${gr}): ${l.join(', ')}.` });
    return out.sort((a, b) => (a.nivel === 'alta' ? 0 : 1) - (b.nivel === 'alta' ? 0 : 1));
  }

  window.VADEMECUM = { lista: M, buscar, grupoDe, revisar, FRECUENCIAS, DURACIONES, norm };
})();
