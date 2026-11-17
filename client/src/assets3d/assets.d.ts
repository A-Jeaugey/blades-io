// Modèles 3D importés par leur adresse (Vite les copie dans /assets/ avec
// une empreinte, donc en cache permanent comme le reste du moteur).
declare module "*.glb?url" {
  const url: string;
  export default url;
}
