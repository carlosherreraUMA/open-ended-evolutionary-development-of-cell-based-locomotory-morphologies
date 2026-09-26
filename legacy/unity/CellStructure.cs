using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;



public  class CellStructure12{
	public    GameObject cell;
	public int typeOfCell;
	public int levelFromRoot;
	public int levelInRegion;
	public int region;
	public int orientat;
	public bool springCell;
	//    public List<SpringJoint> ListOfSprings;

	public CellStructure12(GameObject Ob, int type, int level1, int level2, int orientation, bool spcell, int reg)
	{
		cell=Ob;
		typeOfCell=type;
		levelFromRoot=level1;
		levelInRegion=level2;
		orientat = orientation;
		springCell = spcell;
		region = reg;
		//        ListOfSprings = new List<SpringJoint>();
	}
}

public class LinkStructure12{
	public SpringJoint joint;
	public float frequency;
	public float amplitude;
	public float range;


	public  LinkStructure12(SpringJoint newJoint, float freq, float amp){
		joint = newJoint;
		range = (float)0.15;
		frequency= freq;
		amplitude= amp;
	}
	public  LinkStructure12(SpringJoint newJoint, float ran,float freq, float amp){
		joint = newJoint;
		range = ran;
		frequency= freq;
		amplitude= amp;
	}
}