/* SPDX-License-Identifier: GPL-3.0-only */
// Shared viewport for sliding comparison and single-image modes. Coordinates
// are CSS pixels relative to the visible stage, not physical canvas pixels.
export class CompareViewport {
    constructor() { this.fit(); }
    fit() { this.zoom=1; this.panX=0; this.panY=0; }
    transform(width,height,imageWidth,imageHeight) {
        const base=Math.min(width/imageWidth,height/imageHeight),scale=base*this.zoom;
        return {width,height,scale,x:(width-imageWidth*scale)/2+this.panX,y:(height-imageHeight*scale)/2+this.panY};
    }
    zoomAt(width,height,imageWidth,imageHeight,x,y,deltaY) {
        if(!(width>0&&height>0&&imageWidth>0&&imageHeight>0))return;
        const current=this.transform(width,height,imageWidth,imageHeight);
        const next=Math.max(0.1,Math.min(16,this.zoom*Math.exp(-Math.max(-240,Math.min(240,deltaY))*.0015)));
        const ratio=next/this.zoom;
        const nextX=x-(x-current.x)*ratio,nextY=y-(y-current.y)*ratio;
        this.zoom=next;
        const centered=this.transform(width,height,imageWidth,imageHeight);
        this.panX+=nextX-centered.x;this.panY+=nextY-centered.y;
    }
    pan(dx,dy) {this.panX+=dx;this.panY+=dy;}
}
