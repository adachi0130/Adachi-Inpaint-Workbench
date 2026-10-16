import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
import torch

spec=importlib.util.spec_from_file_location('inline_crop_tests',Path(__file__).resolve().parents[1]/'backend.py')
backend=importlib.util.module_from_spec(spec);spec.loader.exec_module(backend)
def url(image):
    b=io.BytesIO();image.save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()

class InlineCropTests(unittest.TestCase):
    def setUp(self):
        pixels=np.arange(96*128*3,dtype=np.uint8).reshape(96,128,3)
        self.source=url(Image.fromarray(pixels));self.original=torch.from_numpy(pixels.astype(np.float32)/255)[None]
        self.region=dict(x=32,y=16,width=64,height=64,locked=True,job='region-a')
        self.state=json.dumps(self.region)
    def test_legacy_mask_mode_ignores_result_and_keeps_original_ports(self):
        image,mask,full=backend.AdachiInlineMask().load(source_data=self.source,result=torch.ones(1,64,64,3))
        self.assertTrue(torch.equal(image,self.original));self.assertTrue(torch.equal(image,full));self.assertEqual(tuple(mask.shape),(1,96,128))
    def test_crop_source_and_generation_mask_are_sliced_at_exact_coordinates(self):
        pixels=np.zeros((96,128),dtype=np.uint8);pixels[20:24,35:40]=255
        image,mask,full=backend.AdachiInlineMask().load(source_data=self.source,mask_data=url(Image.fromarray(pixels)),edit_mode='crop',crop_state=self.state)
        self.assertTrue(torch.equal(image,self.original[:,16:80,32:96]));self.assertTrue(torch.equal(full,self.original))
        self.assertEqual(mask.sum().item(),20);self.assertEqual(mask[0,4,3].item(),1)
    def test_layer_blend_preserves_outside_and_supports_batch_and_soft_edges(self):
        alpha=np.zeros((64,64),dtype=np.uint8);alpha[:,:32]=255;alpha[:,32:48]=128
        result=torch.stack([torch.zeros(64,64,3),torch.ones(64,64,3)])
        blended=backend._blend_layer(self.original,result,url(Image.fromarray(alpha)),self.region)
        self.assertEqual(tuple(blended.shape),(2,96,128,3))
        outside=torch.ones(96,128,dtype=torch.bool);outside[16:80,32:96]=False
        for i in range(2):
            self.assertTrue(torch.equal(blended[i][outside],self.original[0][outside]))
            self.assertTrue(torch.equal(blended[i,16:80,32:64],result[i,:,:32]))
            self.assertTrue(torch.equal(blended[i,16:80,80:96],self.original[0,16:80,80:96]))
            self.assertTrue(torch.allclose(blended[i,16:80,64:80],self.original[0,16:80,64:80]*(127/255)+result[i,:,32:48]*(128/255)))
    def test_result_sink_persists_only_one_content_addressed_layer(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict('sys.modules',{'folder_paths':types.SimpleNamespace(get_input_directory=lambda:folder)}):
            args=dict(result=torch.ones(2,64,64,3),source_data=self.source,crop_state=self.state,target='42')
            a=backend.AdachiLayerCommit().compose(**args);b=backend.AdachiLayerCommit().compose(**args)
            self.assertEqual(a['ui'],b['ui']);self.assertEqual(a['ui']['adachi_layer'][0]['target'],'42')
            self.assertEqual(a['ui']['adachi_layer'][0]['job'],'region-a')
            self.assertEqual(len(list(Path(folder).rglob('*.png'))),1)
            descriptor=a['ui']['adachi_layer'][0]['image'];name=descriptor['subfolder']+'/'+descriptor['filename']
            image,_,full=backend.AdachiInlineMask().load(source_data=self.source,edit_mode='crop',crop_state=self.state,layer_image=name)
            self.assertTrue(torch.equal(image,torch.ones(1,64,64,3)));self.assertTrue(torch.equal(full,a['result'][0][:1]))
    def test_invalid_regions_or_result_sizes_fail_before_writing(self):
        for change in ({'x':-1},{'y':80},{'width':65},{'height':0},{'x':True}):
            with self.subTest(change=change),self.assertRaises(ValueError):
                backend._blend_layer(self.original,torch.ones(1,64,64,3),'',{**self.region,**change})
        with patch.object(backend,'_store_layer') as store:
            with self.assertRaisesRegex(ValueError,'must match'):
                backend.AdachiLayerCommit().compose(torch.ones(1,32,64,3),source_data=self.source,crop_state=self.state)
            store.assert_not_called()
    def test_mask_mode_removes_feedback_even_when_connected(self):
        data={'prompt':{'1':{'class_type':'AdachiInlineMask','inputs':{'result':['2',0]}},'2':{'class_type':'ImageInvert','inputs':{'image':['1',0]}}}}
        backend.normalize_exclusive_prompt(data)
        self.assertNotIn('result',data['prompt']['1']['inputs']);self.assertEqual(len(data['prompt']),2)
    def test_crop_feedback_is_split_before_validation_and_full_output_redirected(self):
        data={'prompt':{'1':{'class_type':'AdachiInlineMask','inputs':{'result':['2',0],'edit_mode':'crop','crop_state':self.state,'image':'sample.png'}},'2':{'class_type':'ImageInvert','inputs':{'image':['1',0]}},'3':{'class_type':'SaveImage','inputs':{'images':['1',2]}}}}
        backend.normalize_exclusive_prompt(data);p=data['prompt']
        self.assertNotIn('result',p['1']['inputs']);self.assertEqual(p['2']['inputs']['image'],['1',0]);self.assertEqual(p['3']['inputs']['images'],['adachi_layer_1',0])
        self.assertEqual(p['adachi_layer_1']['inputs']['result'],['2',0]);self.assertEqual(p['adachi_layer_1']['inputs']['target'],'1')
        backend.normalize_crop_prompt(data);self.assertEqual(len(p),4)
    def test_fingerprint_tracks_mode_blend_and_layer(self):
        first=backend.AdachiInlineMask.IS_CHANGED(source_data=self.source,edit_mode='mask')
        for extra in ({'edit_mode':'crop'},{'blend_data':'new'},{'layer_image':'changed.png'}):
            self.assertNotEqual(first,backend.AdachiInlineMask.IS_CHANGED(source_data=self.source,**extra))

if __name__=='__main__':unittest.main()
