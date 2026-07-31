// Lista fechada de países (nomes em português, minúsculos, sem acento) para
// validar instantaneamente a categoria "País" sem gastar chamada de IA.
export const COUNTRIES_NORMALIZED = [
  "afeganistao","africa do sul","albania","alemanha","andorra","angola",
  "antigua e barbuda","arabia saudita","argelia","argentina","armenia",
  "australia","austria","azerbaijao","bahamas","bahrein","bangladesh",
  "barbados","belarus","belgica","belize","benin","bolivia",
  "bosnia e herzegovina","botsuana","brasil","brunei","bulgaria",
  "burkina faso","burundi","butao","cabo verde","camaroes","camboja",
  "canada","catar","cazaquistao","chade","chile","china","chipre",
  "colombia","comores","congo","coreia do norte","coreia do sul",
  "costa do marfim","costa rica","croacia","cuba","dinamarca","djibuti",
  "dominica","egito","el salvador","emirados arabes unidos","equador",
  "eritreia","eslovaquia","eslovenia","espanha","estados unidos",
  "estonia","etiopia","fiji","filipinas","finlandia","franca","gabao",
  "gambia","gana","georgia","granada","grecia","guatemala","guine",
  "guine equatorial","guine-bissau","guiana","haiti","holanda","honduras",
  "hungria","iemen","india","indonesia","ira","iraque","irlanda",
  "islandia","israel","italia","jamaica","japao","jordania","kiribati",
  "kosovo","kuwait","laos","lesoto","letonia","libano","liberia",
  "libia","liechtenstein","lituania","luxemburgo","macedonia do norte",
  "madagascar","malasia","malaui","maldivas","mali","malta","marrocos",
  "mauricio","mauritania","mexico","micronesia","mocambique","moldavia",
  "monaco","mongolia","montenegro","namibia","nauru","nepal","nicaragua",
  "niger","nigeria","noruega","nova zelandia","oma","paises baixos",
  "palau","panama","papua-nova guine","paquistao","paraguai","peru",
  "polonia","portugal","quenia","quirguistao","reino unido",
  "republica centro-africana","republica dominicana","republica tcheca",
  "romenia","ruanda","russia","salomao","samoa","san marino",
  "santa lucia","sao cristovao e neves","sao tome e principe",
  "sao vicente e granadinas","senegal","serra leoa","servia",
  "seychelles","singapura","siria","somalia","sri lanka","suazilandia",
  "sudao","sudao do sul","suecia","suica","suriname","tailandia",
  "taiwan","tajiquistao","tanzania","timor-leste","togo","tonga",
  "trindade e tobago","tunisia","turcomenistao","turquia","tuvalu",
  "ucrania","uganda","uruguai","uzbequistao","vanuatu","vaticano",
  "venezuela","vietna","zambia","zimbabue"
];

export function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function isValidCountry(answer) {
  return COUNTRIES_NORMALIZED.includes(normalize(answer));
}
