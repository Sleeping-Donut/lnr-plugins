{
  description = "LNReader extension repository: self-hosted Kavita source plugin";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.git
            ];

            shellHook = ''
              echo "LNReader plugin devshell"
              echo "  node $(node --version)"
              echo "  npm  $(npm --version)"
              echo
              echo "Run: npm install && npm run dev:start"
            '';
          };
        });
    };
}
