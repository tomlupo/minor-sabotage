import Phaser from "phaser";
import { PAL, css } from "../art/palette";

/** Temporary boot scene: proves the pixel pipeline (scale, palette, canvas textures). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create() {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 18;
    const g = c.getContext("2d")!;
    const ramps = [PAL.city_1943.cobble, PAL.city_1943.brick, PAL.city_1943.plaster_ochre, PAL.troopers.occupier_field_grey];
    ramps.forEach((r, i) => r.forEach((col, j) => {
      g.fillStyle = css(col);
      g.fillRect(i * 24 + j * 8, 0, 8, 18);
    }));
    this.textures.addCanvas("swatch", c);
    const { width, height } = this.scale;
    this.add.image(width / 2, height / 2, "swatch").setOrigin(0.5);
    this.add.rectangle(1, 1, width - 2, height - 2).setOrigin(0).setStrokeStyle(1, 0xe8be46);
    (window as unknown as { __ms: { ready: boolean } }).__ms.ready = true;
  }
}
